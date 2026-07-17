/**
 * Checklist templates (admin-managed boilerplate) and per-ticket checklist
 * items. Template mutation is admin-only; working a ticket's checklist is any
 * write-capable role (baseline RBAC already blocks readonly mutation).
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireRole } from '../middleware/auth';
import { parseId } from '../util/ids';
import { isPlainRecord } from '../util/objects';
import { hasPrismaCode } from '../util/prismaErrors';
import * as templateRepo from '../repositories/checklistTemplateRepository';
import * as checklistRepo from '../repositories/checklistRepository';
import * as ticketRepo from '../repositories/ticketRepository';

interface IdParam { id: string }
interface ItemParam { id: string; itemId: string }

const MAX_TEMPLATE_ITEMS = 100;

function validateTemplateItems(value: unknown): string | null {
  if (!Array.isArray(value)) return 'items must be an array';
  if (value.length > MAX_TEMPLATE_ITEMS) return `items may contain at most ${MAX_TEMPLATE_ITEMS} entries`;
  for (const item of value) {
    if (!isPlainRecord(item)) return 'each item must be an object';
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 500) {
      return 'each item needs text up to 500 characters';
    }
    const offset = item.dueOffsetMinutes;
    if (offset !== undefined && offset !== null) {
      if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 60 * 24 * 365) {
        return 'dueOffsetMinutes must be an integer between 0 and one year';
      }
    }
  }
  return null;
}

function validateTemplateInput(value: unknown, creating: boolean): string | null {
  if (!isPlainRecord(value)) return 'request body must be an object';
  if (creating && (typeof value.name !== 'string' || !value.name.trim())) return 'name is required';
  if (value.name !== undefined && (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 150)) {
    return 'name must be a non-empty string up to 150 characters';
  }
  if (value.description !== undefined && value.description !== null
    && (typeof value.description !== 'string' || value.description.length > 500)) {
    return 'description must be a string up to 500 characters or null';
  }
  if (value.active !== undefined && typeof value.active !== 'boolean') return 'active must be a boolean';
  if (value.items !== undefined) return validateTemplateItems(value.items);
  return null;
}

/** Item text/done/dueAt/sortOrder for POST (creating) and PATCH bodies. */
function validateItemInput(value: unknown, creating: boolean): string | null {
  if (!isPlainRecord(value)) return 'request body must be an object';
  if (creating && (typeof value.text !== 'string' || !value.text.trim())) return 'text is required';
  if (value.text !== undefined && (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 500)) {
    return 'text must be a non-empty string up to 500 characters';
  }
  if (value.done !== undefined && typeof value.done !== 'boolean') return 'done must be a boolean';
  if (value.dueAt !== undefined && value.dueAt !== null) {
    if (typeof value.dueAt !== 'string' || Number.isNaN(Date.parse(value.dueAt))) {
      return 'dueAt must be an ISO 8601 datetime string or null';
    }
  }
  if (value.sortOrder !== undefined && (!Number.isInteger(value.sortOrder) || Math.abs(value.sortOrder as number) > 1_000_000)) {
    return 'sortOrder must be an integer';
  }
  return null;
}

function parsedDueAt(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value as string);
}

export async function checklistRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };

  // ---- Templates -----------------------------------------------------------

  // Any authenticated user can list (the ticket dialog offers "apply").
  server.get('/checklist-templates', async (req: FastifyRequest, reply: FastifyReply) => {
    const includeInactive = (req.query as Record<string, string>).includeInactive === 'true';
    return reply.send(await templateRepo.list({ includeInactive }));
  });

  server.post('/checklist-templates', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const error = validateTemplateInput(req.body, true);
    if (error) return reply.status(400).send({ error });
    try {
      return reply.status(201).send(await templateRepo.create(req.body as templateRepo.ChecklistTemplateInput, req.actorSub));
    } catch (err) {
      if (hasPrismaCode(err, 'P2002')) return reply.status(409).send({ error: 'A template with that name already exists' });
      throw err;
    }
  });

  server.patch<{ Params: IdParam }>('/checklist-templates/:id', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid template id' });
    const error = validateTemplateInput(req.body, false);
    if (error) return reply.status(400).send({ error });
    try {
      const template = await templateRepo.update(id, req.body as Partial<templateRepo.ChecklistTemplateInput>, req.actorSub);
      if (!template) return reply.status(404).send({ error: 'Template not found' });
      return reply.send(template);
    } catch (err) {
      if (hasPrismaCode(err, 'P2002')) return reply.status(409).send({ error: 'A template with that name already exists' });
      throw err;
    }
  });

  server.delete<{ Params: IdParam }>('/checklist-templates/:id', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid template id' });
    const removed = await templateRepo.remove(id, req.actorSub);
    if (!removed) return reply.status(404).send({ error: 'Template not found' });
    return reply.status(204).send();
  });

  // ---- Ticket checklist ----------------------------------------------------

  server.get('/tickets/:id/checklist', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    if (!(await ticketRepo.getById(id))) return reply.status(404).send({ error: 'Ticket not found' });
    return reply.send(await checklistRepo.listForTicket(id));
  });

  server.post('/tickets/:id/checklist', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const error = validateItemInput(req.body, true);
    if (error) return reply.status(400).send({ error });
    if (!(await ticketRepo.getById(id))) return reply.status(404).send({ error: 'Ticket not found' });
    const body = req.body as Record<string, unknown>;
    const item = await checklistRepo.add(id, { text: body.text as string, dueAt: parsedDueAt(body.dueAt) ?? null }, req.actorSub);
    return reply.status(201).send(item);
  });

  server.post('/tickets/:id/checklist/apply-template', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    if (!isPlainRecord(req.body) || !Number.isInteger(req.body.templateId)) {
      return reply.status(400).send({ error: 'templateId is required' });
    }
    if (!(await ticketRepo.getById(id))) return reply.status(404).send({ error: 'Ticket not found' });
    const items = await checklistRepo.applyTemplate(id, req.body.templateId as number, req.actorSub);
    if (!items) return reply.status(404).send({ error: 'Template not found or inactive' });
    return reply.send(items);
  });

  server.patch('/tickets/:id/checklist/:itemId', async (req: FastifyRequest<{ Params: ItemParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    const itemId = parseId(req.params.itemId);
    if (id === null || itemId === null) return reply.status(400).send({ error: 'invalid id' });
    const error = validateItemInput(req.body, false);
    if (error) return reply.status(400).send({ error });
    const body = req.body as Record<string, unknown>;
    const item = await checklistRepo.update(id, itemId, {
      text: body.text as string | undefined,
      done: body.done as boolean | undefined,
      dueAt: parsedDueAt(body.dueAt),
      sortOrder: body.sortOrder as number | undefined,
    }, req.actorSub);
    if (!item) return reply.status(404).send({ error: 'Checklist item not found' });
    return reply.send(item);
  });

  server.delete('/tickets/:id/checklist/:itemId', async (req: FastifyRequest<{ Params: ItemParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    const itemId = parseId(req.params.itemId);
    if (id === null || itemId === null) return reply.status(400).send({ error: 'invalid id' });
    const removed = await checklistRepo.remove(id, itemId, req.actorSub);
    if (!removed) return reply.status(404).send({ error: 'Checklist item not found' });
    return reply.status(204).send();
  });
}
