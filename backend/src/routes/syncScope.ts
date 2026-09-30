import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireRole } from '../middleware/auth';
import { parseId } from '../util/ids';
import { SyncAccountBusyError } from '../services/syncAccountLock';
import * as bypass from '../services/syncBypassService';
import * as syncOut from '../services/syncOutService';
import * as queries from '../services/syncScopeQueries';

interface IdParam { id: string }

/**
 * Sync scope: sending tickets to a PSA, bypass requests for tickets that left
 * their job's scope, and the job editor's people picker and preview. See
 * docs/roadmap-sync-scope.md.
 *
 * Technicians may send tickets and ask for bypasses (readonly users are already
 * refused every mutation by the auth layer). Deciding a bypass, and the editor
 * helpers, are admin surfaces.
 */
export async function syncScopeRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };

  const who = (req: FastifyRequest): bypass.Requester => ({
    actor: req.actorSub ?? 'system',
    userId: req.user?.id && req.user.id > 0 ? req.user.id : null,
    isAdmin: req.user?.role === 'admin',
  });

  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof bypass.BypassError || err instanceof syncOut.SyncOutError) {
      return reply.status(err.status).send({ error: err.message });
    }
    if (err instanceof SyncAccountBusyError) return reply.status(409).send({ error: err.message });
    throw err;
  };

  // ─── Send to PSA ──────────────────────────────────────────────────────────

  /** Where a ticket can be created: enabled two-way jobs, with why not if not. */
  server.get('/sync/destinations', async (_req, reply) => reply.send(await syncOut.listDestinations()));

  server.post<{ Params: IdParam }>('/tickets/:id/sync-out', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const jobId = (req.body as { jobId?: unknown })?.jobId;
    if (!Number.isInteger(jobId) || (jobId as number) <= 0) {
      return reply.status(400).send({ error: 'jobId must be a sync job id' });
    }
    try {
      return reply.send(await syncOut.sendToPsa(id, jobId as number, who(req).actor));
    } catch (err) {
      return fail(reply, err);
    }
  });

  // ─── Bypass requests ──────────────────────────────────────────────────────

  /** The ticket's sync job, whether it stopped syncing and why, and its bypass requests. */
  server.get<{ Params: IdParam }>('/tickets/:id/sync-scope', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    try {
      return reply.send(await bypass.scopeForTicket(id));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Ask to keep a detached ticket syncing. An admin asking is approved at once. */
  server.post<{ Params: IdParam }>('/tickets/:id/sync-bypass', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const reason = (req.body as { reason?: unknown })?.reason;
    if (typeof reason !== 'string') return reply.status(400).send({ error: 'reason is required' });
    try {
      return reply.status(201).send(await bypass.request(id, reason, who(req)));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Remove an approved bypass; the ticket follows its job's filter again. */
  server.delete<{ Params: IdParam }>('/tickets/:id/sync-bypass', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    try {
      await bypass.unpin(id, who(req));
      return reply.status(204).send();
    } catch (err) {
      return fail(reply, err);
    }
  });

  server.get('/sync/bypass-requests', adminOnly, async (req, reply) => {
    const status = (req.query as { status?: string })?.status;
    if (status && !['pending', 'approved', 'rejected'].includes(status)) {
      return reply.status(400).send({ error: 'status must be pending, approved or rejected' });
    }
    return reply.send(await bypass.listQueue(status as 'pending' | 'approved' | 'rejected' | undefined));
  });

  for (const decision of ['approve', 'reject'] as const) {
    server.post<{ Params: IdParam }>(`/sync/bypass-requests/:id/${decision}`, adminOnly, async (req, reply) => {
      const id = parseId(req.params.id);
      if (id === null) return reply.status(400).send({ error: 'invalid request id' });
      const note = (req.body as { note?: unknown })?.note;
      try {
        return reply.send(
          await bypass.decide(id, decision === 'approve' ? 'approved' : 'rejected', who(req), typeof note === 'string' ? note : undefined),
        );
      } catch (err) {
        return fail(reply, err);
      }
    });
  }

  // ─── Job editor helpers ───────────────────────────────────────────────────

  /** People on the remote to filter by: Jira accounts or ConnectWise members. */
  server.get('/sync/people', adminOnly, async (req, reply) => {
    const q = req.query as { type?: string; connectionId?: string; q?: string };
    if (q.type !== 'jira' && q.type !== 'connectwise') return reply.status(400).send({ error: 'type must be jira or connectwise' });
    const connectionId = q.connectionId ? parseId(q.connectionId) : null;
    if (q.connectionId && connectionId === null) return reply.status(400).send({ error: 'invalid connectionId' });
    try {
      return reply.send(await queries.searchPeople(q.type, connectionId, q.q ?? ''));
    } catch (err) {
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  /** How many tickets a job with this (unsaved) configuration would import. */
  server.post('/sync/preview', adminOnly, async (req, reply) => {
    const body = (req.body ?? {}) as { type?: string; connectionId?: number | null; config?: Record<string, unknown> };
    if (body.type !== 'jira' && body.type !== 'connectwise') return reply.status(400).send({ error: 'type must be jira or connectwise' });
    if (body.config != null && (typeof body.config !== 'object' || Array.isArray(body.config))) {
      return reply.status(400).send({ error: 'config must be an object' });
    }
    try {
      return reply.send(await queries.previewJob(body.type, body.connectionId ?? null, body.config ?? {}));
    } catch (err) {
      return reply.status(502).send({ error: (err as Error).message });
    }
  });
}
