import { FastifyInstance } from 'fastify';
import { AutomationTrigger } from '@prisma/client';
import { requireRole } from '../middleware/auth';
import { parseId } from '../util/ids';
import { isPlainRecord } from '../util/objects';
import { hasPrismaCode } from '../util/prismaErrors';
import * as automationRepo from '../repositories/automationRepository';
import { validateRuleAction, validateRuleCondition } from '../services/automation/evaluate';

interface IdParam { id: string }

const TRIGGERS: AutomationTrigger[] = ['ticket_created', 'ticket_updated', 'note_added', 'sla_at_risk', 'sla_breached'];
function validateRule(body: Partial<automationRepo.AutomationRuleInput>, partial: boolean): string | null {
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) return 'name must be a non-empty string up to 120 characters';
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return 'enabled must be a boolean';
  if (!partial || body.trigger !== undefined) {
    if (!body.trigger || !TRIGGERS.includes(body.trigger)) return `trigger must be one of: ${TRIGGERS.join(', ')}`;
  }
  if (body.conditions !== undefined) {
    if (!Array.isArray(body.conditions) || body.conditions.length > 50) return 'conditions must be an array with at most 50 items';
    for (const condition of body.conditions) {
      const error = validateRuleCondition(condition);
      if (error) return error;
    }
  }
  if (!partial || body.actions !== undefined) {
    if (!Array.isArray(body.actions) || body.actions.length === 0 || body.actions.length > 20) {
      return 'actions must be a non-empty array with at most 20 items';
    }
    for (const action of body.actions) {
      const error = validateRuleAction(action);
      if (error) return error;
    }
  }
  return null;
}

export async function automationRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };

  server.get('/automations', adminOnly, async (_req, reply) => {
    return reply.send(await automationRepo.list());
  });

  server.post('/automations', adminOnly, async (req, reply) => {
    if (!isPlainRecord(req.body)) return reply.status(400).send({ error: 'request body must be an object' });
    const body = { ...req.body, conditions: req.body.conditions ?? [] } as unknown as automationRepo.AutomationRuleInput;
    const error = validateRule(body, false);
    if (error) return reply.status(400).send({ error });
    return reply.status(201).send(await automationRepo.create(body, req.actorSub));
  });

  server.patch<{ Params: IdParam }>('/automations/:id', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid id' });
    if (!isPlainRecord(req.body)) return reply.status(400).send({ error: 'request body must be an object' });
    const body = (req.body ?? {}) as Partial<automationRepo.AutomationRuleInput>;
    const error = validateRule(body, true);
    if (error) return reply.status(400).send({ error });
    try {
      return reply.send(await automationRepo.update(id, body, req.actorSub));
    } catch (error) {
      if (hasPrismaCode(error, 'P2025')) return reply.status(404).send({ error: 'Automation rule not found' });
      throw error;
    }
  });

  server.delete<{ Params: IdParam }>('/automations/:id', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid id' });
    try {
      await automationRepo.remove(id, req.actorSub);
      return reply.status(204).send();
    } catch (error) {
      if (hasPrismaCode(error, 'P2025')) return reply.status(404).send({ error: 'Automation rule not found' });
      throw error;
    }
  });
}
