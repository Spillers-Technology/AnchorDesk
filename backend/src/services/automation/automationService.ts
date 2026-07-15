/**
 * Automation engine: subscribes to the event bus (Observer, alongside the
 * notification service) and runs enabled AutomationRules whose trigger matches
 * the event. Conditions are evaluated by the pure `evaluate` module; actions
 * are applied through the normal repositories so every change is audited and
 * republished live. SLA escalation is just a rule on the sla_* triggers.
 *
 * Loop guard: every automation mutation is attributed to "automation:<rule>",
 * and events from such actors are ignored here — a rule can react to a human
 * or sync change, never to another rule (no chains, no cycles).
 */
import { AutomationTrigger } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { subscribe, publish, DomainEvent } from '../realtime/eventBus';
import * as automationRepo from '../../repositories/automationRepository';
import * as ticketRepo from '../../repositories/ticketRepository';
import * as noteRepo from '../../repositories/noteRepository';
import * as labelRepo from '../../repositories/labelRepository';
import * as teamRepo from '../../repositories/teamRepository';
import * as notificationRepo from '../../repositories/notificationRepository';
import * as audit from '../../repositories/auditRepository';
import { evaluateConditions, ticketContext, RuleCondition, RuleAction, EvalContext } from './evaluate';

const AUTOMATION_ACTOR_PREFIX = 'automation:';

function triggerFor(event: DomainEvent): AutomationTrigger | null {
  switch (event.type) {
    case 'ticket.created':
      return 'ticket_created';
    case 'ticket.updated':
      return 'ticket_updated';
    case 'note.added':
      return 'note_added';
    case 'sla.atRisk':
      return event.level === 'breached' ? 'sla_breached' : 'sla_at_risk';
    default:
      return null;
  }
}

async function notify(userId: number, ticketId: number, title: string, actor: string, body?: string) {
  const notification = await notificationRepo.create({ userId, type: 'automation', ticketId, title, body });
  await audit.record({
    entityType: 'notification',
    entityId: notification.id,
    action: 'create',
    changedBy: actor,
    newValue: { userId, ticketId, type: 'automation', title },
  });
  publish({ type: 'notification.created', userId, notification });
}

async function applyAction(action: RuleAction, ticketId: number, ticketTitle: string, actor: string): Promise<void> {
  switch (action.type) {
    case 'set_status':
      await ticketRepo.update(ticketId, { status: action.status }, actor);
      break;
    case 'set_priority':
      await ticketRepo.update(ticketId, { priority: action.priority }, actor);
      break;
    case 'assign_user': {
      const user = await prisma.user.findUnique({ where: { id: action.userId } });
      if (!user) throw new Error(`automation assignee user ${action.userId} not found`);
      await ticketRepo.update(ticketId, { assigneeId: user.id, assignee: user.displayName ?? user.username }, actor);
      break;
    }
    case 'assign_team':
      await ticketRepo.update(ticketId, { teamId: action.teamId }, actor);
      break;
    case 'add_label':
      await labelRepo.applyToTicket(ticketId, action.labelId, actor);
      break;
    case 'add_note':
      await noteRepo.create(ticketId, { content: action.content, author: actor, noteType: 'internal' }, actor);
      break;
    case 'notify_user':
      await notify(action.userId, ticketId, action.message ?? `Automation matched ticket #${ticketId}`, actor, ticketTitle);
      break;
    case 'notify_team': {
      if (!(await teamRepo.getById(action.teamId))) throw new Error(`automation notification team ${action.teamId} not found`);
      const userIds = await teamRepo.memberUserIds(action.teamId);
      for (const userId of userIds) {
        await notify(userId, ticketId, action.message ?? `Automation matched ticket #${ticketId}`, actor, ticketTitle);
      }
      break;
    }
  }
}

async function buildContext(event: DomainEvent, ticketId: number): Promise<EvalContext | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { labels: true },
  });
  if (!ticket) return null;
  const ctx = ticketContext(ticket);
  if (event.type === 'sla.atRisk') {
    ctx.kind = event.kind;
    ctx.level = event.level;
  }
  return ctx;
}

async function handle(event: DomainEvent): Promise<void> {
  const trigger = triggerFor(event);
  if (!trigger) return;
  // Never react to our own actions (or another rule's) — hard loop guard.
  if ('actor' in event && typeof event.actor === 'string' && event.actor.startsWith(AUTOMATION_ACTOR_PREFIX)) return;

  const rules = await automationRepo.listEnabledFor(trigger);
  if (rules.length === 0) return;

  const ticketId = 'ticketId' in event ? event.ticketId : null;
  if (!ticketId) return;
  const ctx = await buildContext(event, ticketId);
  if (!ctx) return;

  for (const rule of rules) {
    try {
      const conditions = (rule.conditions ?? []) as unknown as RuleCondition[];
      if (!evaluateConditions(Array.isArray(conditions) ? conditions : [], ctx)) continue;
      const actor = `${AUTOMATION_ACTOR_PREFIX}${rule.name}`;
      const actions = (rule.actions ?? []) as unknown as RuleAction[];
      for (const action of Array.isArray(actions) ? actions : []) {
        await applyAction(action, ticketId, String(ctx.title ?? ''), actor);
      }
      await automationRepo.markRan(rule.id);
    } catch (error) {
      // One broken rule must never take down the event pipeline or block
      // sibling rules — log and continue.
      console.error(`automation rule "${rule.name}" failed:`, error);
    }
  }
}

let started = false;

/** Subscribe to the event bus. Call once at boot. */
export function initAutomationService(): void {
  if (started) return;
  started = true;
  subscribe((event) => {
    void handle(event);
  });
}
