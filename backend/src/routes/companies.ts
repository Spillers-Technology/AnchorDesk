/**
 * CRM routes: companies + their contacts, plus company rollups (tickets,
 * devices, logged time). Reads/writes follow baseline RBAC (readonly can't
 * mutate); deleting a company is admin-only since it detaches tickets/devices.
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireRole } from '../middleware/auth';
import * as companyRepo from '../repositories/companyRepository';
import * as ticketRepo from '../repositories/ticketRepository';
import * as portalGrantRepo from '../repositories/portalGrantRepository';
import { requestMagicLink } from '../services/auth/portalMagicLinks';
import { parseId } from '../util/ids';

interface IdParam {
  id: string;
}

export async function companyRoutes(server: FastifyInstance) {
  // ─── Companies ────────────────────────────────────────────────────────────
  server.get('/companies', async (_req, reply) => {
    return reply.send(await companyRepo.list());
  });

  server.get<{ Params: IdParam }>('/companies/:id', async (req, reply) => {
    const company = await companyRepo.getById(parseInt(req.params.id, 10));
    if (!company) return reply.status(404).send({ error: 'company not found' });
    return reply.send(company);
  });

  // Backfill Company records from legacy companyName strings (admin).
  server.post('/companies/backfill', { preHandler: requireRole('admin') }, async (req, reply) => {
    return reply.send(await companyRepo.backfillFromNames(req.actorSub));
  });

  server.post('/companies', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as companyRepo.CompanyInput;
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name is required' });
    const existing = await companyRepo.findByName(body.name.trim());
    if (existing) return reply.status(409).send({ error: 'a company with that name already exists' });
    const company = await companyRepo.create(body, req.actorSub);
    return reply.status(201).send(company);
  });

  server.patch<{ Params: IdParam }>('/companies/:id', async (req, reply) => {
    const company = await companyRepo.update(parseInt(req.params.id, 10), (req.body ?? {}) as companyRepo.CompanyInput, req.actorSub);
    return reply.send(company);
  });

  server.delete<{ Params: IdParam }>('/companies/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const company = await companyRepo.remove(parseInt(req.params.id, 10), req.actorSub);
    if (!company) return reply.status(404).send({ error: 'company not found' });
    return reply.status(204).send();
  });

  // ─── Company rollups ────────────────────────────────────────────────────────
  server.get<{ Params: IdParam }>('/companies/:id/tickets', async (req, reply) => {
    return reply.send(await ticketRepo.listForCompany(parseInt(req.params.id, 10)));
  });

  server.get<{ Params: IdParam }>('/companies/:id/devices', async (req, reply) => {
    return reply.send(await companyRepo.devicesForCompany(parseInt(req.params.id, 10)));
  });

  server.get<{ Params: IdParam }>('/companies/:id/time', async (req, reply) => {
    const minutes = await companyRepo.timeTotalMinutes(parseInt(req.params.id, 10));
    return reply.send({ minutes });
  });

  // ─── Contacts ─────────────────────────────────────────────────────────────
  server.post<{ Params: IdParam }>('/companies/:id/contacts', async (req, reply) => {
    const body = (req.body ?? {}) as Omit<companyRepo.ContactInput, 'companyId'>;
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name is required' });
    const contact = await companyRepo.createContact({ ...body, companyId: parseInt(req.params.id, 10) }, req.actorSub);
    return reply.status(201).send(contact);
  });

  server.patch<{ Params: IdParam }>('/contacts/:id', async (req, reply) => {
    const contact = await companyRepo.updateContact(parseInt(req.params.id, 10), (req.body ?? {}) as companyRepo.ContactInput, req.actorSub);
    return reply.send(contact);
  });

  server.delete<{ Params: IdParam }>('/contacts/:id', async (req, reply) => {
    const contact = await companyRepo.removeContact(parseInt(req.params.id, 10), req.actorSub);
    if (!contact) return reply.status(404).send({ error: 'contact not found' });
    return reply.status(204).send();
  });

  // ─── Portal access (Portal v2) ──────────────────────────────────────────────
  // Same baseline write-role RBAC as the contact edit routes above — granting
  // portal access is normal CRM work, not an admin-only action.
  server.get<{ Params: IdParam }>('/contacts/:id/portal-grants', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid contact id' });
    return reply.send(await portalGrantRepo.listForContact(id));
  });

  server.post<{ Params: IdParam }>('/contacts/:id/portal-grant', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid contact id' });
    const contact = await companyRepo.getContactById(id);
    if (!contact) return reply.status(404).send({ error: 'contact not found' });

    const body = (req.body ?? {}) as { effectiveFrom?: string };
    let effectiveFrom: Date | undefined;
    if (body.effectiveFrom !== undefined) {
      if (typeof body.effectiveFrom !== 'string' || Number.isNaN(Date.parse(body.effectiveFrom))) {
        return reply.status(400).send({ error: 'effectiveFrom must be an ISO 8601 datetime string' });
      }
      effectiveFrom = new Date(body.effectiveFrom);
    }

    const row = await portalGrantRepo.grant(
      { contactId: contact.id, companyId: contact.companyId, effectiveFrom },
      req.actorSub,
    );
    // Access without a way in is a support ticket we created for ourselves —
    // fire-and-forget, same non-blocking pattern as the portal's own
    // magic-link request route (SMTP latency must not hold up this response).
    if (contact.email) {
      setImmediate(() => {
        void requestMagicLink(contact.email).catch(() => {
          req.log.warn('Portal grant auto-send of magic link failed');
        });
      });
    }
    return reply.status(201).send(row);
  });

  server.post<{ Params: IdParam }>('/contacts/:id/portal-grant/revoke', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid contact id' });
    const row = await portalGrantRepo.revoke(id, req.actorSub);
    if (!row) return reply.status(404).send({ error: 'no active portal grant for this contact' });
    return reply.send(row);
  });
}
