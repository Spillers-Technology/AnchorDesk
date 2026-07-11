import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { runSync, runAllSync } from '../services/syncService';
import { requireRole } from '../middleware/auth';
import { parseId } from '../util/ids';

interface ProviderIdParam { providerId: string }
const SUPPORTED_PROVIDER_TYPES = ['connectwise'] as const;

export async function syncRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };

  // Trigger a sync run — all enabled providers, or a specific one
  server.post('/sync/run', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const providerName = query.provider;

    try {
      if (providerName) {
        const provider = await prisma.syncProvider.findUnique({ where: { name: providerName } });
        if (!provider) return reply.status(404).send({ error: `Provider '${providerName}' not found` });
        if (!provider.enabled) return reply.status(400).send({ error: `Provider '${providerName}' is disabled` });

        const result = await runSync(provider as Parameters<typeof runSync>[0]);
        return reply.send(result);
      }

      const results = await runAllSync();
      return reply.send(results);
    } catch (err) {
      server.log.error('Sync failed:', err);
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // List configured providers with their status
  server.get('/sync/providers', async (_req: FastifyRequest, reply: FastifyReply) => {
    const providers = await prisma.syncProvider.findMany({
      orderBy: { name: 'asc' },
      // Exclude sensitive config from the response
      select: {
        id: true,
        name: true,
        type: true,
        enabled: true,
        lastSyncedAt: true,
        createdAt: true,
      },
    });
    return reply.send(providers);
  });

  // Create a ticket sync provider. Credentials stay in Admin → Integrations;
  // provider config contains only adapter-specific options such as CW board.
  server.post('/sync/providers', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      name?: string;
      type?: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
    };
    const name = body.name?.trim();
    const type = body.type?.trim();
    if (!name) return reply.status(400).send({ error: 'name is required' });
    if (name.length > 100) return reply.status(400).send({ error: 'name must be 100 characters or fewer' });
    if (!type || !SUPPORTED_PROVIDER_TYPES.includes(type as (typeof SUPPORTED_PROVIDER_TYPES)[number])) {
      return reply.status(400).send({ error: `type must be one of: ${SUPPORTED_PROVIDER_TYPES.join(', ')}` });
    }
    if (body.config != null && (typeof body.config !== 'object' || Array.isArray(body.config))) {
      return reply.status(400).send({ error: 'config must be an object' });
    }

    try {
      const created = await prisma.syncProvider.create({
        data: {
          name,
          type: type as 'connectwise',
          enabled: body.enabled ?? true,
          config: (body.config ?? {}) as Prisma.InputJsonValue,
        },
        select: { id: true, name: true, type: true, enabled: true, lastSyncedAt: true, createdAt: true },
      });
      return reply.status(201).send(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: `Provider '${name}' already exists` });
      }
      throw err;
    }
  });

  // Enable/disable a provider
  server.patch<{ Params: ProviderIdParam }>('/sync/providers/:providerId', adminOnly, async (req, reply) => {
    const id = parseId(req.params.providerId);
    if (id === null) return reply.status(400).send({ error: 'invalid provider id' });
    const body = req.body as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') return reply.status(400).send({ error: 'enabled must be a boolean' });
    try {
      const provider = await prisma.syncProvider.update({
        where: { id },
        data: { enabled: body.enabled },
        select: { id: true, name: true, type: true, enabled: true, lastSyncedAt: true },
      });
      return reply.send(provider);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'provider not found' });
      }
      throw err;
    }
  });

  // Delete a provider and its sync log (cascade in the schema).
  server.delete<{ Params: ProviderIdParam }>('/sync/providers/:providerId', adminOnly, async (req, reply) => {
    const id = parseId(req.params.providerId);
    if (id === null) return reply.status(400).send({ error: 'invalid provider id' });
    try {
      await prisma.syncProvider.delete({ where: { id } });
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'provider not found' });
      }
      throw err;
    }
  });

  // Sync log — recent entries, optionally filtered by provider
  server.get('/sync/log', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const limit = Math.min(parseInt(query.limit ?? '100'), 500);

    const where = query.provider
      ? { provider: { name: query.provider } }
      : {};

    const logs = await prisma.syncLog.findMany({
      where,
      orderBy: { syncedAt: 'desc' },
      take: limit,
      include: { provider: { select: { name: true, type: true } } },
    });

    // SyncLog.id is a BigInt; the JSON serializer can't encode BigInt, so map it
    // to a Number before sending (ids fit comfortably in a JS safe integer).
    return reply.send(logs.map((log) => ({ ...log, id: Number(log.id) })));
  });
}
