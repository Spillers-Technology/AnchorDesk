/**
 * Connection routes — CRUD plus a non-mutating credential test for external
 * ticket accounts (currently Jira sites; ConnectWise remains deliberately
 * process-global until its client is de-singletoned).
 *
 * Everything here is admin-only, and no response ever contains a secret: the
 * repository's `toPublic()` collapses them to `hasApiToken`-style flags.
 *
 * The test endpoint exists because the product previously had no way to answer
 * "are these credentials right?". The original reported failure was an Atlassian
 * *organization* API key used where a user API token was required — it
 * authenticates fine against the admin API and 403s against the issue API, so
 * saving it looked successful and every sync silently returned nothing.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma, ProviderType } from '@prisma/client';
import { requireRole } from '../middleware/auth';
import { parseId } from '../util/ids';
import * as connectionRepo from '../repositories/connectionRepository';
import { testConnection } from '../services/connectionTest';

interface IdParam {
  id: string;
}

export async function connectionRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };

  server.get('/connections', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const { type } = req.query as { type?: string };
    if (type && !connectionRepo.SUPPORTED_CONNECTION_TYPES.includes(type as connectionRepo.ConnectionType)) {
      return reply.status(400).send({ error: `type must be one of: ${connectionRepo.SUPPORTED_CONNECTION_TYPES.join(', ')}` });
    }
    const rows = await connectionRepo.list(type as ProviderType | undefined);
    return reply.send(rows.map(connectionRepo.toPublic));
  });

  server.get<{ Params: IdParam }>('/connections/:id', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid connection id' });
    const row = await connectionRepo.getById(id);
    if (!row) return reply.status(404).send({ error: 'connection not found' });
    return reply.send(connectionRepo.toPublic(row));
  });

  server.post('/connections', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      name?: string;
      type?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    };

    if (body.name !== undefined && typeof body.name !== 'string') {
      return reply.status(400).send({ error: 'name must be a string' });
    }
    const name = body.name?.trim();
    if (!name) return reply.status(400).send({ error: 'name is required' });
    if (name.length > 100) return reply.status(400).send({ error: 'name must be 100 characters or fewer' });
    if (!body.type || !connectionRepo.SUPPORTED_CONNECTION_TYPES.includes(body.type as connectionRepo.ConnectionType)) {
      return reply
        .status(400)
        .send({ error: `type must be one of: ${connectionRepo.SUPPORTED_CONNECTION_TYPES.join(', ')}` });
    }
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return reply.status(400).send({ error: 'enabled must be a boolean' });
    }
    if (body.config !== undefined && (body.config === null || typeof body.config !== 'object' || Array.isArray(body.config))) {
      return reply.status(400).send({ error: 'config must be an object' });
    }

    try {
      const row = await connectionRepo.create(
        { name, type: body.type as ProviderType, config: body.config, enabled: body.enabled },
        req.actorSub ?? 'system'
      );
      return reply.status(201).send(connectionRepo.toPublic(row));
    } catch (err) {
      if (err instanceof connectionRepo.ConnectionValidationError) {
        return reply.status(400).send({ error: err.message });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: `A connection named "${name}" already exists` });
      }
      throw err;
    }
  });

  server.patch<{ Params: IdParam }>('/connections/:id', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid connection id' });

    const body = (req.body ?? {}) as {
      name?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
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
    if (body.name === undefined && body.enabled === undefined && body.config === undefined) {
      return reply.status(400).send({ error: 'no recognized fields to update (name, enabled, config)' });
    }

    try {
      const row = await connectionRepo.update(id, body, req.actorSub ?? 'system');
      if (!row) return reply.status(404).send({ error: 'connection not found' });
      return reply.send(connectionRepo.toPublic(row));
    } catch (err) {
      if (err instanceof connectionRepo.ConnectionBusyError) {
        return reply.status(409).send({ error: err.message });
      }
      if (err instanceof connectionRepo.ConnectionIdentityConflictError) {
        return reply.status(409).send({ error: err.message });
      }
      if (err instanceof connectionRepo.ConnectionValidationError) {
        return reply.status(400).send({ error: err.message });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.status(409).send({ error: 'A connection with that name already exists' });
      }
      throw err;
    }
  });

  server.delete<{ Params: IdParam }>('/connections/:id', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid connection id' });
    try {
      await connectionRepo.remove(id, req.actorSub ?? 'system');
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof connectionRepo.ConnectionValidationError) {
        // In use by sync jobs — a 409 so the UI can offer to reassign them.
        return reply.status(409).send({ error: err.message });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.status(404).send({ error: 'connection not found' });
      }
      throw err;
    }
  });

  /** Verify stored credentials against the remote. Read-only by construction. */
  server.post<{ Params: IdParam }>('/connections/:id/test', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid connection id' });

    const row = await connectionRepo.getById(id);
    if (!row) return reply.status(404).send({ error: 'connection not found' });

    const result = await testConnection(row.type, (row.config ?? {}) as Record<string, unknown>);
    try {
      await connectionRepo.recordTestResult(
        id,
        row.configRevision,
        result.ok,
        result.message
      );
      return reply.send({ ...result, testedAt: new Date().toISOString() });
    } catch (err) {
      if (err instanceof connectionRepo.ConnectionTestStaleError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });
}
