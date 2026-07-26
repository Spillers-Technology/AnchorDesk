import { FastifyBaseLogger } from 'fastify';
import { TERMINAL_TICKET_STATUSES } from '../ticketVocab';
import { DomainEvent, TicketMetricContext, subscribe } from './eventBus';
import * as ticketEvents from '../../repositories/ticketEventRepository';

const terminalStatuses = new Set<string>(TERMINAL_TICKET_STATUSES);

function statusKind(from: string, to: string): ticketEvents.TicketEventKind {
  const wasTerminal = terminalStatuses.has(from);
  const isTerminal = terminalStatuses.has(to);
  if (!wasTerminal && isTerminal) return 'resolved';
  if (wasTerminal && !isTerminal && to !== 'Deleted') return 'reopened';
  return 'status_changed';
}

function source(
  auditId: string | undefined,
  fallback: string,
): Pick<ticketEvents.AppendTicketEvent, 'sourceAuditId' | 'sourceKey'> {
  return auditId ? { sourceAuditId: auditId } : { sourceKey: fallback };
}

function base(
  event: { ticketId: number; actor?: string; auditId?: string },
  kind: ticketEvents.TicketEventKind,
  context: TicketMetricContext,
): AppendBase {
  return {
    ticketId: event.ticketId,
    kind,
    actor: event.actor ?? null,
    companyId: context.companyId,
    teamId: context.teamId,
    assigneeId: context.assigneeId,
    priority: context.priority,
    occurredAt: context.occurredAt,
    ...source(
      event.auditId,
      `domain:${event.ticketId}:${kind}:${context.occurredAt.toISOString()}`,
    ),
  };
}

type AppendBase = Omit<ticketEvents.AppendTicketEvent, 'fromValue' | 'toValue'>;

/** Pure event classification. Missing transition discriminators intentionally
 * produce no facts; the subscriber never guesses by re-reading Ticket. */
export function factsForDomainEvent(event: DomainEvent): ticketEvents.AppendTicketEvent[] {
  switch (event.type) {
    case 'ticket.created': {
      if (!event.metric) return [];
      const fact = base(event, 'created', event.metric.context);
      return [{ ...fact, fromValue: null, toValue: event.metric.context.status }];
    }

    case 'ticket.updated': {
      const metric = event.metric;
      if (!metric) return [];
      const facts: ticketEvents.AppendTicketEvent[] = [];

      if (metric.merge) {
        const fact = base(event, 'merged', metric.context);
        facts.push({
          ...fact,
          fromValue: metric.merge.fromStatus,
          toValue: String(metric.merge.targetId),
        });
        return facts;
      }

      if (metric.unmerge) {
        const kind = statusKind(metric.unmerge.fromStatus, metric.unmerge.toStatus);
        const fact = base(event, kind, metric.context);
        facts.push({
          ...fact,
          fromValue: metric.unmerge.fromStatus,
          toValue: metric.unmerge.toStatus,
        });
        return facts;
      }

      if (metric.status && metric.status.from !== metric.status.to) {
        const kind = statusKind(metric.status.from, metric.status.to);
        const fact = base(event, kind, metric.context);
        facts.push({
          ...fact,
          fromValue: metric.status.from,
          toValue: metric.status.to,
        });
      }
      if (metric.assignment) {
        const fact = base(event, 'assigned', metric.context);
        facts.push({
          ...fact,
          fromValue:
            `a:${metric.assignment.fromAssigneeId ?? ''};` +
            `t:${metric.assignment.fromTeamId ?? ''}`,
          toValue:
            `a:${metric.assignment.toAssigneeId ?? ''};` +
            `t:${metric.assignment.toTeamId ?? ''}`,
        });
      }
      if (metric.contextChanged) {
        const fact = base(event, 'context_changed', metric.context);
        facts.push({ ...fact, fromValue: null, toValue: null });
      }
      return facts;
    }

    case 'ticket.deleted': {
      const transition = event.metric?.status;
      if (!event.metric || !transition || transition.from === transition.to) return [];
      const fact = base(event, 'status_changed', event.metric.context);
      return [{ ...fact, fromValue: transition.from, toValue: transition.to }];
    }

    case 'note.added': {
      if (!event.firstResponseRecorded || !event.metricContext) return [];
      const fact = base(event, 'first_response', event.metricContext);
      return [{ ...fact, fromValue: null, toValue: 'responded' }];
    }

    case 'sla.atRisk': {
      if (
        event.level !== 'breached' ||
        event.targetSource !== 'sla' ||
        !event.dueAt ||
        !event.metricContext
      ) {
        return [];
      }
      const context = event.metricContext;
      return [{
        ticketId: event.ticketId,
        kind: 'sla_breached',
        fromValue: event.kind,
        toValue: event.dueAt.toISOString(),
        actor: 'sla_scheduler',
        companyId: context.companyId,
        teamId: context.teamId,
        assigneeId: context.assigneeId,
        priority: context.priority,
        occurredAt: context.occurredAt,
        sourceKey:
          `sla:${event.ticketId}:${event.kind}:` +
          (event.targetIdentity ?? event.dueAt.toISOString()),
      }];
    }

    default:
      return [];
  }
}

/** Async handler exported for direct tests; DB uniqueness makes retries safe. */
export async function persistDomainEvent(event: DomainEvent): Promise<number> {
  return ticketEvents.append(factsForDomainEvent(event));
}

export function subscribeTicketEventFacts(log?: Pick<FastifyBaseLogger, 'error'>): () => void {
  return subscribe((event) => {
    void persistDomainEvent(event).catch((error) => {
      // The transactionally written audit row is the durable recovery source;
      // the next boot backfill will insert the missing fact as reconstruction.
      log?.error({ err: error, eventType: event.type }, 'Failed to persist ticket metric event');
    });
  });
}

let started = false;

/** Initialize the reporting subscriber once at boot. */
export function initTicketEventSubscriber(log: FastifyBaseLogger): void {
  if (started) return;
  started = true;
  subscribeTicketEventFacts(log);
}
