import { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/auth';
import * as labelRepo from '../repositories/labelRepository';

interface IdParam { id: string }
interface TicketLabelParams { id: string; labelId: string }

export async function labelRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };

  // List labels — any authenticated user (needed to render/filter).
  server.get('/labels', async (_req, reply) => {
    return reply.send(await labelRepo.list());
  });

  server.post('/labels', adminOnly, async (req, reply) => {
    const body = (req.body ?? {}) as labelRepo.LabelInput;
    if (!body.name) return reply.status(400).send({ error: 'name is required' });
    return reply.status(201).send(await labelRepo.create(body));
  });
  server.patch<{ Params: IdParam }>('/labels/:id', adminOnly, async (req, reply) => {
    return reply.send(await labelRepo.update(parseInt(req.params.id), (req.body ?? {}) as Partial<labelRepo.LabelInput>));
  });
  server.delete<{ Params: IdParam }>('/labels/:id', adminOnly, async (req, reply) => {
    await labelRepo.remove(parseInt(req.params.id));
    return reply.status(204).send();
  });

  // Tag / untag a ticket (technicians + admins).
  server.post<{ Params: IdParam }>('/tickets/:id/labels', async (req, reply) => {
    const { labelId } = (req.body ?? {}) as { labelId?: number };
    if (!labelId) return reply.status(400).send({ error: 'labelId is required' });
    await labelRepo.applyToTicket(parseInt(req.params.id), labelId);
    return reply.status(201).send({ ok: true });
  });
  server.delete<{ Params: TicketLabelParams }>('/tickets/:id/labels/:labelId', async (req, reply) => {
    await labelRepo.removeFromTicket(parseInt(req.params.id), parseInt(req.params.labelId));
    return reply.status(204).send();
  });
}
