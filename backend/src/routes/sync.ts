import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma, ProviderType } from '@prisma/client';
import { prisma } from '../db/prisma';
import {
  isSyncActive,
  runSync,
  runAllSync,
  SyncAlreadyRunningError,
  SyncRunFinalizationError,
} from '../services/syncService';
import { requireRole } from '../middleware/auth';
import { parseId } from '../util/ids';
import * as syncProviderRepo from '../repositories/syncProviderRepository';
import * as syncRunRepo from '../repositories/syncRunRepository';
import {
  SyncAccountBusyError,
  SyncAccountClaimChangedError,
  listSyncAccountClaims,
  recoverSyncAccountClaim,
} from '../services/syncAccountLock';

interface ProviderIdParam { providerId: string }
interface RunIdParam { runId: string }

export async function syncRoutes(server: FastifyInstance) {
  // Ticket sync configuration and manual runs are an admin console surface
  // (Admin → Ticket sync), not a technician workspace — see docs/sow-sync-ux.md,
  // open question 2. Gating the read endpoints too (not just the mutations)
  // keeps the API honest about that even if a client bypasses the UI.
  const adminOnly = { preHandler: requireRole('admin') };

  // Trigger a sync run — all enabled providers, or a specific one
  server.post('/sync/run', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const providerName = query.provider;

    try {
      if (providerName) {
        const provider = await syncProviderRepo.getByName(providerName);
        if (!provider) return reply.status(404).send({ error: `Provider '${providerName}' not found` });
        if (!provider.enabled) return reply.status(400).send({ error: `Provider '${providerName}' is disabled` });

        const result = await runSync(provider as Parameters<typeof runSync>[0], {
          trigger: 'manual',
          actor: req.actorSub ?? 'system',
        });
        return reply.send(result);
      }

      const results = await runAllSync({ trigger: 'manual', actor: req.actorSub ?? 'system' });
      return reply.send(results);
    } catch (err) {
      server.log.error({ err }, 'Sync failed');
      if (err instanceof SyncAlreadyRunningError) {
        return reply.status(409).send({ error: 'this sync job is already running' });
      }
      if (err instanceof SyncAccountBusyError) {
        return reply.status(409).send({ error: err.message });
      }
      if (err instanceof syncRunRepo.SyncRunStartConflictError) {
        return reply.status(409).send({ error: err.message });
      }
      if (err instanceof SyncRunFinalizationError) {
        return reply.status(500).send({
          error: 'the sync work finished, but its run record could not be finalized',
          runId: err.runId,
        });
      }
      return reply
        .status(500)
        .send({ error: syncRunRepo.sanitizeSyncError((err as Error).message) });
    }
  });

  // List configured sync jobs with their status. `config` is the safe,
  // type-specific DTO (e.g. { projectKey, jql, filter }) — never raw JSON.
  server.get('/sync/providers', adminOnly, async (_req: FastifyRequest, reply: FastifyReply) => {
    const providers = await syncProviderRepo.list();
    const health = await syncRunRepo.healthForProviders(
      providers.map(({ id, configRevision }) => ({ id, configRevision }))
    );
    return reply.send(
      providers.map((provider) => ({
        ...syncProviderRepo.toPublic(provider),
        health: health.get(provider.id),
      }))
    );
  });

  // Create a ticket sync job. Account credentials live on a Connection
  // (`connectionId`); job config holds only this type's scope (Jira
  // project/JQL, CW board) plus the shared provider-neutral filter.
  server.post('/sync/providers', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      name?: string;
      type?: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
      connectionId?: number | null;
    };
    if (body.name !== undefined && typeof body.name !== 'string') {
      return reply.status(400).send({ error: 'name must be a string' });
    }
    if (body.type !== undefined && typeof body.type !== 'string') {
      return reply.status(400).send({ error: 'type must be a string' });
    }
    const name = body.name?.trim();
    const type = body.type?.trim();
    if (!name) return reply.status(400).send({ error: 'name is required' });
    if (name.length > 100) return reply.status(400).send({ error: 'name must be 100 characters or fewer' });
    if (!type || !syncProviderRepo.SUPPORTED_PROVIDER_TYPES.includes(type as syncProviderRepo.SyncProviderType)) {
      return reply
        .status(400)
        .send({ error: `type must be one of: ${syncProviderRepo.SUPPORTED_PROVIDER_TYPES.join(', ')}` });
    }
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return reply.status(400).send({ error: 'enabled must be a boolean' });
    }
    if (body.config !== undefined && (body.config === null || typeof body.config !== 'object' || Array.isArray(body.config))) {
      return reply.status(400).send({ error: 'config must be an object' });
    }
    if (body.connectionId != null && !Number.isInteger(body.connectionId)) {
      return reply.status(400).send({ error: 'connectionId must be an integer' });
    }

    try {
      const created = await syncProviderRepo.create(
        {
          name,
          type: type as ProviderType,
          enabled: body.enabled,
          config: body.config,
          connectionId: body.connectionId ?? null,
        },
        req.actorSub ?? 'system'
      );
      return reply.status(201).send(syncProviderRepo.toPublic(created));
    } catch (err) {
      if (err instanceof syncProviderRepo.SyncProviderValidationError) {
        return reply.status(400).send({ error: err.message });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: `Provider '${name}' already exists` });
      }
      throw err;
    }
  });

  // Edit a sync job in place: name, enabled state, linked connection, and
  // type-specific config. Provider type is immutable after creation — a
  // different type is a different job.
  server.patch<{ Params: ProviderIdParam }>('/sync/providers/:providerId', adminOnly, async (req, reply) => {
    const id = parseId(req.params.providerId);
    if (id === null) return reply.status(400).send({ error: 'invalid provider id' });

    const body = (req.body ?? {}) as {
      name?: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
      connectionId?: number | null;
    };
    if (body.name !== undefined && typeof body.name !== 'string') {
      return reply.status(400).send({ error: 'name must be a string' });
    }
    if (body.name !== undefined && !body.name.trim()) {
      return reply.status(400).send({ error: 'name is required' });
    }
    if (body.name !== undefined && body.name.trim().length > 100) {
      return reply.status(400).send({ error: 'name must be 100 characters or fewer' });
    }
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return reply.status(400).send({ error: 'enabled must be a boolean' });
    }
    if (body.config !== undefined && (body.config === null || typeof body.config !== 'object' || Array.isArray(body.config))) {
      return reply.status(400).send({ error: 'config must be an object' });
    }
    if (body.connectionId !== undefined && body.connectionId !== null && !Number.isInteger(body.connectionId)) {
      return reply.status(400).send({ error: 'connectionId must be an integer or null' });
    }
    // Checking recognized keys, not just a nonempty body: a body containing
    // only unrecognized fields (e.g. an accidental `{"type":"connectwise"}`)
    // would otherwise pass through as a silent no-op update that still writes
    // a misleading "updated" audit row.
    if (
      body.name === undefined &&
      body.enabled === undefined &&
      body.config === undefined &&
      body.connectionId === undefined
    ) {
      return reply.status(400).send({ error: 'no recognized fields to update (name, enabled, connectionId, config)' });
    }
    if (
      isSyncActive(id) &&
      (body.connectionId !== undefined || body.config !== undefined)
    ) {
      return reply
        .status(409)
        .send({ error: 'wait for the active sync run to finish before changing its account or scope' });
    }

    try {
      const provider = await syncProviderRepo.update(id, body, req.actorSub ?? 'system');
      if (!provider) return reply.status(404).send({ error: 'provider not found' });
      return reply.send(syncProviderRepo.toPublic(provider));
    } catch (err) {
      if (err instanceof syncProviderRepo.SyncProviderBusyError) {
        return reply.status(409).send({ error: err.message });
      }
      if (err instanceof syncProviderRepo.SyncProviderValidationError) {
        return reply.status(400).send({ error: err.message });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: 'a provider with that name already exists' });
      }
      throw err;
    }
  });

  // Delete a provider and its durable run/activity history (cascade in the schema).
  server.delete<{ Params: ProviderIdParam }>('/sync/providers/:providerId', adminOnly, async (req, reply) => {
    const id = parseId(req.params.providerId);
    if (id === null) return reply.status(400).send({ error: 'invalid provider id' });
    if (isSyncActive(id)) {
      return reply.status(409).send({ error: 'wait for the active sync run to finish before deleting this job' });
    }
    try {
      const removed = await syncProviderRepo.remove(id, req.actorSub ?? 'system');
      if (!removed) return reply.status(404).send({ error: 'provider not found' });
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof syncProviderRepo.SyncProviderBusyError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });

  // Break-glass recovery for a claim left behind by a crashed worker. This is
  // intentionally explicit and never age-triggered: an old timestamp alone
  // cannot prove that remote writes stopped.
  server.get('/sync/account-claims', adminOnly, async (_req, reply) => {
    return reply.send({
      claims: await listSyncAccountClaims(),
      recoveryWarning:
        'Recover only after every AnchorDesk backend sync worker has been stopped or restarted; recovering a live claim can overlap remote writes.',
    });
  });

  server.post('/sync/account-claims/recover', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      accountKey?: unknown;
      observedClaimedAt?: unknown;
      confirmation?: unknown;
    };
    if (typeof body.accountKey !== 'string' || !body.accountKey.trim()) {
      return reply.status(400).send({ error: 'accountKey is required' });
    }
    if (
      typeof body.observedClaimedAt !== 'string' ||
      Number.isNaN(Date.parse(body.observedClaimedAt))
    ) {
      return reply.status(400).send({ error: 'observedClaimedAt must be an ISO 8601 timestamp' });
    }
    const requiredConfirmation = 'I stopped or restarted every AnchorDesk backend sync worker';
    if (body.confirmation !== requiredConfirmation) {
      return reply.status(400).send({
        error: `confirmation must exactly equal: ${requiredConfirmation}`,
      });
    }

    try {
      const result = await recoverSyncAccountClaim(
        body.accountKey.trim(),
        new Date(body.observedClaimedAt),
        req.actorSub ?? 'system'
      );
      return reply.send({
        ...result,
        recovered: true,
        warning: 'The claim was released because you confirmed all backend sync workers were stopped or restarted.',
      });
    } catch (err) {
      if (err instanceof SyncAccountBusyError || err instanceof SyncAccountClaimChangedError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });

  // Durable run summaries — successful zero-ticket runs are represented here,
  // unlike the record-oriented sync_log table.
  server.get('/sync/runs', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { provider?: string; limit?: string };
    const limit = Number(query.limit ?? 50);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      return reply.status(400).send({ error: 'limit must be an integer from 1 to 200' });
    }
    const runs = await syncRunRepo.list({ providerName: query.provider, limit });
    return reply.send(runs.map((run) => ({ ...syncRunRepo.toPublicSummary(run), provider: run.provider })));
  });

  // One run plus its bounded, record-level activity. SyncLog.id is BigInt, so
  // map it before Fastify's JSON serializer sees it.
  server.get<{ Params: RunIdParam }>('/sync/runs/:runId', adminOnly, async (req, reply) => {
    const id = parseId(req.params.runId);
    if (id === null) return reply.status(400).send({ error: 'invalid run id' });
    const run = await syncRunRepo.getWithLogs(id);
    if (!run) return reply.status(404).send({ error: 'sync run not found' });
    return reply.send({
      ...syncRunRepo.toPublicSummary(run),
      provider: run.provider,
      logCount: run._count.syncLogs,
      logsTruncated: run._count.syncLogs > run.syncLogs.length,
      logs: run.syncLogs.map((log) => ({
        ...log,
        id: Number(log.id),
        message: log.message ? syncRunRepo.sanitizeSyncError(log.message) : null,
      })),
    });
  });

  // Sync log — recent entries, optionally filtered by provider
  server.get('/sync/log', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const requestedLimit = Number(query.limit ?? 100);
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) {
      return reply.status(400).send({ error: 'limit must be an integer from 1 to 500' });
    }

    const where = query.provider
      ? { provider: { name: query.provider } }
      : {};

    const logs = await prisma.syncLog.findMany({
      where,
      orderBy: { syncedAt: 'desc' },
      take: requestedLimit,
      include: { provider: { select: { name: true, type: true } } },
    });

    // SyncLog.id is a BigInt; the JSON serializer can't encode BigInt, so map it
    // to a Number before sending (ids fit comfortably in a JS safe integer).
    return reply.send(
      logs.map((log) => ({
        ...log,
        id: Number(log.id),
        message: log.message ? syncRunRepo.sanitizeSyncError(log.message) : null,
      }))
    );
  });
}
