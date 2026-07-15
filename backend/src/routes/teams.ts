import { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/auth';
import { parseId } from '../util/ids';
import { isPlainRecord } from '../util/objects';
import { hasPrismaCode } from '../util/prismaErrors';
import * as teamRepo from '../repositories/teamRepository';

interface IdParam { id: string }
interface MemberParams { id: string; userId: string }

function validateTeam(input: Partial<teamRepo.TeamInput>, creating: boolean): string | null {
  if (creating || input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) {
      return 'name must be a non-empty string up to 100 characters';
    }
  }
  if (input.description !== undefined && input.description !== null
      && (typeof input.description !== 'string' || input.description.length > 300)) {
    return 'description must be a string up to 300 characters or null';
  }
  return null;
}

export async function teamRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };

  // List teams — any authenticated user (needed for pickers/filters).
  server.get('/teams', async (_req, reply) => {
    return reply.send(await teamRepo.list());
  });

  server.get<{ Params: IdParam }>('/teams/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid team id' });
    const team = await teamRepo.getById(id);
    if (!team) return reply.status(404).send({ error: 'Team not found' });
    return reply.send(team);
  });

  server.post('/teams', adminOnly, async (req, reply) => {
    if (!isPlainRecord(req.body)) return reply.status(400).send({ error: 'request body must be an object' });
    const body = req.body as unknown as teamRepo.TeamInput;
    const validationError = validateTeam(body, true);
    if (validationError) return reply.status(400).send({ error: validationError });
    try {
      return reply.status(201).send(await teamRepo.create(body, req.actorSub));
    } catch (error) {
      if (hasPrismaCode(error, 'P2002')) return reply.status(409).send({ error: 'A team with that name already exists' });
      throw error;
    }
  });

  server.patch<{ Params: IdParam }>('/teams/:id', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid team id' });
    if (!isPlainRecord(req.body)) return reply.status(400).send({ error: 'request body must be an object' });
    const body = (req.body ?? {}) as Partial<teamRepo.TeamInput>;
    const validationError = validateTeam(body, false);
    if (validationError) return reply.status(400).send({ error: validationError });
    try {
      return reply.send(await teamRepo.update(id, body, req.actorSub));
    } catch (error) {
      if (hasPrismaCode(error, 'P2002')) return reply.status(409).send({ error: 'A team with that name already exists' });
      if (hasPrismaCode(error, 'P2025')) return reply.status(404).send({ error: 'Team not found' });
      throw error;
    }
  });

  server.delete<{ Params: IdParam }>('/teams/:id', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid team id' });
    try {
      await teamRepo.remove(id, req.actorSub);
      return reply.status(204).send();
    } catch (error) {
      if (hasPrismaCode(error, 'P2025')) return reply.status(404).send({ error: 'Team not found' });
      throw error;
    }
  });

  server.post<{ Params: IdParam }>('/teams/:id/members', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (!isPlainRecord(req.body)) return reply.status(400).send({ error: 'request body must be an object' });
    const { userId } = (req.body ?? {}) as { userId?: number };
    if (id === null || !Number.isInteger(userId) || Number(userId) <= 0) {
      return reply.status(400).send({ error: 'team id and a positive integer userId are required' });
    }
    try {
      return reply.status(201).send(await teamRepo.addMember(id, userId as number, req.actorSub));
    } catch (error) {
      if (hasPrismaCode(error, 'P2003', 'P2025')) return reply.status(404).send({ error: 'Team or user not found' });
      throw error;
    }
  });

  server.delete<{ Params: MemberParams }>('/teams/:id/members/:userId', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    if (id === null || userId === null) return reply.status(400).send({ error: 'invalid ids' });
    const team = await teamRepo.getById(id);
    if (!team) return reply.status(404).send({ error: 'Team not found' });
    return reply.send(await teamRepo.removeMember(id, userId, req.actorSub));
  });
}
