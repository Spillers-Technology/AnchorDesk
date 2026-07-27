import { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/auth';
import * as slaRepo from '../repositories/slaPolicyRepository';

interface IdParam { id: string }

export async function slaRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };

  // List policies — any authenticated user (needed to render SLA context).
  server.get('/sla/policies', async (_req, reply) => {
    return reply.send(await slaRepo.list());
  });

  // Create / update / delete are admin-only.
  server.post('/sla/policies', adminOnly, async (req, reply) => {
    const body = (req.body ?? {}) as slaRepo.SlaPolicyInput;
    if (!body.name || body.responseMinutes == null || body.resolutionMinutes == null) {
      return reply.status(400).send({ error: 'name, responseMinutes, and resolutionMinutes are required' });
    }
    return reply.status(201).send(await slaRepo.create(body, req.actorSub));
  });

  server.patch<{ Params: IdParam }>('/sla/policies/:id', adminOnly, async (req, reply) => {
    const updated = await slaRepo.update(
      parseInt(req.params.id),
      (req.body ?? {}) as Partial<slaRepo.SlaPolicyInput>,
      req.actorSub,
    );
    return reply.send(updated);
  });

  server.delete<{ Params: IdParam }>('/sla/policies/:id', adminOnly, async (req, reply) => {
    await slaRepo.remove(parseInt(req.params.id), req.actorSub);
    return reply.status(204).send();
  });
}
