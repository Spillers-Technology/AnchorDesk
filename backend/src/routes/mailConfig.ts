import { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/auth';
import * as identityRepo from '../repositories/mailIdentityRepository';
import * as templateRepo from '../repositories/mailTemplateRepository';

interface IdParam { id: string }

export async function mailConfigRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };

  // ─── Send-from identities ──────────────────────────────────────────────────
  // Composer list: the identities THIS user may send as (shared + own aliases).
  server.get('/mail/identities', async (req, reply) => {
    return reply.send(await identityRepo.listForUser(req.user.id));
  });

  // Admin management (all identities).
  server.get('/mail/identities/all', adminOnly, async (_req, reply) => {
    return reply.send(await identityRepo.list());
  });
  server.post('/mail/identities', adminOnly, async (req, reply) => {
    const body = (req.body ?? {}) as identityRepo.MailIdentityInput;
    if (!body.address) return reply.status(400).send({ error: 'address is required' });
    return reply.status(201).send(await identityRepo.create(body));
  });
  server.patch<{ Params: IdParam }>('/mail/identities/:id', adminOnly, async (req, reply) => {
    return reply.send(await identityRepo.update(parseInt(req.params.id), (req.body ?? {}) as Partial<identityRepo.MailIdentityInput>));
  });
  server.delete<{ Params: IdParam }>('/mail/identities/:id', adminOnly, async (req, reply) => {
    await identityRepo.remove(parseInt(req.params.id));
    return reply.status(204).send();
  });

  // ─── Boilerplate templates ─────────────────────────────────────────────────
  server.get('/mail/templates', async (_req, reply) => {
    return reply.send(await templateRepo.list());
  });
  server.post('/mail/templates', adminOnly, async (req, reply) => {
    const body = (req.body ?? {}) as templateRepo.MailTemplateInput;
    if (!body.name || !body.bodyHtml) return reply.status(400).send({ error: 'name and bodyHtml are required' });
    return reply.status(201).send(await templateRepo.create(body));
  });
  server.patch<{ Params: IdParam }>('/mail/templates/:id', adminOnly, async (req, reply) => {
    return reply.send(await templateRepo.update(parseInt(req.params.id), (req.body ?? {}) as Partial<templateRepo.MailTemplateInput>));
  });
  server.delete<{ Params: IdParam }>('/mail/templates/:id', adminOnly, async (req, reply) => {
    await templateRepo.remove(parseInt(req.params.id));
    return reply.status(204).send();
  });
}
