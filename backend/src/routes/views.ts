import { FastifyInstance } from 'fastify';
import { parseId } from '../util/ids';
import { isPlainRecord } from '../util/objects';
import { hasPrismaCode } from '../util/prismaErrors';
import * as savedViewRepo from '../repositories/savedViewRepository';

interface IdParam { id: string }

function validateInput(body: Partial<savedViewRepo.SavedViewInput>, creating: boolean): string | null {
  if (creating || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) {
      return 'name must be a non-empty string up to 100 characters';
    }
  }
  if (creating && body.filters === undefined) return 'filters object is required';
  if (body.filters !== undefined) {
    try {
      savedViewRepo.normalizeSavedViewFilters(body.filters);
    } catch (error) {
      if (error instanceof savedViewRepo.SavedViewValidationError) return error.message;
      throw error;
    }
  }
  if (body.shared !== undefined && typeof body.shared !== 'boolean') return 'shared must be a boolean';
  if (body.sortOrder !== undefined && (!Number.isInteger(body.sortOrder) || Math.abs(body.sortOrder) > 1_000_000)) {
    return 'sortOrder must be an integer between -1000000 and 1000000';
  }
  return null;
}

export async function savedViewRoutes(server: FastifyInstance) {
  // A user's own views plus shared ones.
  server.get('/views', async (req, reply) => {
    return reply.send(await savedViewRepo.listForUser(req.user.id));
  });

  server.post('/views', async (req, reply) => {
    if (!isPlainRecord(req.body)) return reply.status(400).send({ error: 'request body must be an object' });
    const body = req.body as unknown as savedViewRepo.SavedViewInput;
    const validationError = validateInput(body, true);
    if (validationError) return reply.status(400).send({ error: validationError });
    // Only admins may publish shared views (they're visible to everyone).
    if (body.shared && req.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Only admins can create shared views' });
    }
    return reply.status(201).send(await savedViewRepo.create(req.user.id, body, req.actorSub));
  });

  server.patch<{ Params: IdParam }>('/views/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid view id' });
    if (!isPlainRecord(req.body)) return reply.status(400).send({ error: 'request body must be an object' });
    const view = await savedViewRepo.getById(id);
    if (!view) return reply.status(404).send({ error: 'View not found' });
    const ownsView = view.userId === req.user.id
      || (req.user.id === 0 && view.userId === null && !view.shared);
    const canEdit = ownsView || (view.shared && req.user.role === 'admin');
    if (!canEdit) return reply.status(403).send({ error: 'Not your view' });
    const body = (req.body ?? {}) as Partial<savedViewRepo.SavedViewInput>;
    if (body.shared !== undefined) return reply.status(400).send({ error: 'A view cannot change between personal and shared' });
    const validationError = validateInput(body, false);
    if (validationError) return reply.status(400).send({ error: validationError });
    try {
      return reply.send(await savedViewRepo.update(id, body, req.actorSub));
    } catch (error) {
      if (hasPrismaCode(error, 'P2025')) return reply.status(404).send({ error: 'View not found' });
      throw error;
    }
  });

  server.delete<{ Params: IdParam }>('/views/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid view id' });
    const view = await savedViewRepo.getById(id);
    if (!view) return reply.status(404).send({ error: 'View not found' });
    const ownsView = view.userId === req.user.id
      || (req.user.id === 0 && view.userId === null && !view.shared);
    const canEdit = ownsView || (view.shared && req.user.role === 'admin');
    if (!canEdit) return reply.status(403).send({ error: 'Not your view' });
    try {
      await savedViewRepo.remove(id, req.actorSub);
      return reply.status(204).send();
    } catch (error) {
      if (hasPrismaCode(error, 'P2025')) return reply.status(404).send({ error: 'View not found' });
      throw error;
    }
  });
}
