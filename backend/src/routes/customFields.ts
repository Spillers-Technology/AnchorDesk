import { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/auth';
import { parseId } from '../util/ids';
import { isPlainRecord } from '../util/objects';
import { hasPrismaCode } from '../util/prismaErrors';
import * as customFieldRepo from '../repositories/customFieldRepository';

interface IdParam { id: string }

const TYPES = ['text', 'number', 'boolean', 'date', 'select'] as const;

function validOptions(value: unknown): value is string[] {
  if (!(
    Array.isArray(value)
    && value.length > 0
    && value.length <= 100
    && value.every((option) => typeof option === 'string' && option.trim().length > 0 && option.length <= 200)
  )) return false;
  const normalized = value.map((option) => option.trim());
  return new Set(normalized).size === normalized.length;
}

function validateCommon(body: Partial<customFieldRepo.CustomFieldDefInput>): string | null {
  if (body.label !== undefined && (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 100)) {
    return 'label must be a non-empty string up to 100 characters';
  }
  if (body.required !== undefined && typeof body.required !== 'boolean') return 'required must be a boolean';
  if (body.archived !== undefined && typeof body.archived !== 'boolean') return 'archived must be a boolean';
  if (body.sortOrder !== undefined && (!Number.isInteger(body.sortOrder) || Math.abs(body.sortOrder) > 1_000_000)) {
    return 'sortOrder must be an integer between -1000000 and 1000000';
  }
  return null;
}

export async function customFieldRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };

  // List definitions — any authenticated user (the ticket dialog renders them).
  server.get('/custom-fields', async (req, reply) => {
    const includeArchived = (req.query as Record<string, string>).includeArchived === 'true';
    return reply.send(await customFieldRepo.list({ includeArchived }));
  });

  server.post('/custom-fields', adminOnly, async (req, reply) => {
    if (!isPlainRecord(req.body)) return reply.status(400).send({ error: 'request body must be an object' });
    const body = req.body as unknown as customFieldRepo.CustomFieldDefInput;
    if (typeof body.key !== 'string' || !customFieldRepo.isValidKey(body.key)) {
      return reply.status(400).send({ error: 'key must be lowercase letters/digits/underscores, starting with a letter' });
    }
    if (typeof body.label !== 'string' || !body.label.trim()) return reply.status(400).send({ error: 'label is required' });
    const commonError = validateCommon(body);
    if (commonError) return reply.status(400).send({ error: commonError });
    if (!TYPES.includes(body.type)) return reply.status(400).send({ error: `type must be one of: ${TYPES.join(', ')}` });
    if (body.type === 'select' && !validOptions(body.options)) {
      return reply.status(400).send({ error: 'select fields need a non-empty options array' });
    }
    if (body.type !== 'select' && body.options != null) {
      return reply.status(400).send({ error: 'options are only valid for select fields' });
    }
    try {
      return reply.status(201).send(await customFieldRepo.create(body, req.actorSub));
    } catch (error) {
      if (hasPrismaCode(error, 'P2002')) return reply.status(409).send({ error: 'A custom field with that key already exists' });
      throw error;
    }
  });

  server.patch<{ Params: IdParam }>('/custom-fields/:id', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid id' });
    if (!isPlainRecord(req.body)) return reply.status(400).send({ error: 'request body must be an object' });
    const body = (req.body ?? {}) as Partial<customFieldRepo.CustomFieldDefInput>;
    if (body.key !== undefined || body.type !== undefined) {
      return reply.status(400).send({ error: 'key and type are immutable; archive and recreate the field instead' });
    }
    const commonError = validateCommon(body);
    if (commonError) return reply.status(400).send({ error: commonError });
    const existing = await customFieldRepo.getById(id);
    if (!existing) return reply.status(404).send({ error: 'Custom field not found' });
    if (body.options !== undefined) {
      if (existing.type === 'select' && !validOptions(body.options)) {
        return reply.status(400).send({ error: 'select fields need a non-empty options array' });
      }
      if (existing.type !== 'select' && body.options !== null) {
        return reply.status(400).send({ error: 'options are only valid for select fields' });
      }
    }
    try {
      return reply.send(await customFieldRepo.update(id, body, req.actorSub));
    } catch (error) {
      if (hasPrismaCode(error, 'P2025')) return reply.status(404).send({ error: 'Custom field not found' });
      throw error;
    }
  });

  server.delete<{ Params: IdParam }>('/custom-fields/:id', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid id' });
    try {
      const removed = await customFieldRepo.remove(id, req.actorSub);
      if (!removed) return reply.status(404).send({ error: 'Custom field not found' });
      return reply.status(204).send();
    } catch (error) {
      if (hasPrismaCode(error, 'P2025')) return reply.status(404).send({ error: 'Custom field not found' });
      throw error;
    }
  });
}
