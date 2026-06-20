import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/prisma';
import { runSync, runAllSync } from '../services/syncService';
import { requireRole } from '../middleware/auth';

interface ProviderIdParam { providerId: string }

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

  // Enable/disable a provider
  server.patch<{ Params: ProviderIdParam }>('/sync/providers/:providerId', adminOnly, async (req, reply) => {
    const body = req.body as { enabled?: boolean };
    const provider = await prisma.syncProvider.update({
      where: { id: parseInt(req.params.providerId) },
      data: { enabled: body.enabled },
      select: { id: true, name: true, type: true, enabled: true, lastSyncedAt: true },
    });
    return reply.send(provider);
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

    return reply.send(logs);
  });
}
