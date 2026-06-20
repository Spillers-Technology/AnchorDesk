/**
 * Admin integration management: editable settings for SMTP / ConnectWise /
 * Tactical, plus IMAP mailbox CRUD and on-demand polling. All admin-only.
 *
 * Settings + mailbox secrets are write-only over the API (never serialized
 * back); blank a secret to keep the current value.
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireRole } from '../middleware/auth';
import * as settings from '../services/settingsService';
import * as mailboxRepo from '../repositories/mailboxRepository';
import { pollMailbox } from '../services/imapService';

interface IdParam {
  id: string;
}

const INTEGRATION_KEYS: settings.IntegrationKey[] = ['smtp', 'connectwise', 'tactical'];
const isKey = (k: string): k is settings.IntegrationKey => INTEGRATION_KEYS.includes(k as settings.IntegrationKey);

export async function integrationRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };

  // ─── Integration settings (smtp / connectwise / tactical) ───────────────────
  server.get('/integrations', adminOnly, async (_req, reply) => {
    const out: Record<string, unknown> = {};
    for (const key of INTEGRATION_KEYS) out[key] = await settings.getPublic(key);
    return reply.send(out);
  });

  server.patch<{ Params: { key: string } }>('/integrations/:key', adminOnly, async (req, reply) => {
    const { key } = req.params;
    if (!isKey(key)) return reply.status(404).send({ error: 'unknown integration' });
    const updated = await settings.updateSetting(key, (req.body ?? {}) as Record<string, unknown>);
    return reply.send(settings.toPublic(key, updated));
  });

  // ─── IMAP mailboxes ─────────────────────────────────────────────────────────
  server.get('/mailboxes', adminOnly, async (_req, reply) => {
    const boxes = await mailboxRepo.list();
    return reply.send(boxes.map(mailboxRepo.toPublic));
  });

  server.post('/mailboxes', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as mailboxRepo.CreateMailboxInput;
    if (!body.name || !body.host || !body.username) {
      return reply.status(400).send({ error: 'name, host, and username are required' });
    }
    const mb = await mailboxRepo.create(body, req.actorSub);
    return reply.status(201).send(mailboxRepo.toPublic(mb));
  });

  server.patch<{ Params: IdParam }>('/mailboxes/:id', adminOnly, async (req, reply) => {
    const mb = await mailboxRepo.update(parseInt(req.params.id, 10), (req.body ?? {}) as Record<string, unknown>, req.actorSub);
    return reply.send(mailboxRepo.toPublic(mb));
  });

  server.delete<{ Params: IdParam }>('/mailboxes/:id', adminOnly, async (req, reply) => {
    const mb = await mailboxRepo.remove(parseInt(req.params.id, 10), req.actorSub);
    if (!mb) return reply.status(404).send({ error: 'mailbox not found' });
    return reply.status(204).send();
  });

  // Poll a mailbox now (test connection + ingest). Returns the poll result.
  server.post<{ Params: IdParam }>('/mailboxes/:id/poll', adminOnly, async (req, reply) => {
    const mb = await mailboxRepo.findById(parseInt(req.params.id, 10));
    if (!mb) return reply.status(404).send({ error: 'mailbox not found' });
    const result = await pollMailbox(mb);
    return reply.send(result);
  });
}
