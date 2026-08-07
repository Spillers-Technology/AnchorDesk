/**
 * In-process domain event bus (Observer pattern), the live-update counterpart to
 * the audit log. Repositories `publish()` after a mutation; subscribers — the
 * WebSocket hub and the notification service — react without the repositories
 * knowing they exist. Single-process only: if you scale to multiple backend
 * replicas, back this with Redis pub/sub (the publish/subscribe surface stays
 * the same).
 */
import { EventEmitter } from 'events';

/** Immutable dimensions captured by the publisher in the same mutation path.
 * Metric subscribers must use this context, never re-read the mutable ticket. */
export interface TicketMetricContext {
  companyId: number | null;
  teamId: number | null;
  assigneeId: number | null;
  priority: string | null;
  status: string;
  occurredAt: Date;
}

export interface TicketMetricTransition {
  context: TicketMetricContext;
  status?: { from: string; to: string };
  assignment?: {
    fromAssigneeId: number | null;
    toAssigneeId: number | null;
    fromTeamId: number | null;
    toTeamId: number | null;
  };
  contextChanged?: boolean;
  merge?: { targetId: number; fromStatus: string };
  unmerge?: { previousTargetId: number; fromStatus: string; toStatus: string };
}

export type DomainEvent =
  | {
      type: 'ticket.created';
      ticketId: number;
      ticket: unknown;
      actor: string;
      auditId?: string;
      metric?: TicketMetricTransition;
    }
  | {
      type: 'ticket.updated';
      ticketId: number;
      ticket: unknown;
      actor: string;
      changes?: Record<string, unknown>;
      auditId?: string;
      metric?: TicketMetricTransition;
    }
  | {
      type: 'ticket.deleted';
      ticketId: number;
      ticket?: unknown;
      actor: string;
      auditId?: string;
      metric?: TicketMetricTransition;
    }
  | {
      type: 'note.added';
      ticketId: number;
      note: unknown;
      actor: string;
      auditId?: string;
      firstResponseRecorded?: boolean;
      metricContext?: TicketMetricContext;
    }
  | {
      type: 'feedback.submitted';
      ticketId: number;
      feedback: unknown;
      actor: string;
    }
  | {
      type: 'sla.atRisk';
      ticketId: number;
      level: 'warning' | 'breached';
      kind: 'response' | 'resolution';
      dueAt?: Date;
      targetSource?: 'sla' | 'manual';
      /** Stable identity of the frozen SLA promise (normally snapshot:<id>). */
      targetIdentity?: string;
      metricContext?: TicketMetricContext;
    }
  | { type: 'notification.created'; userId: number; notification: unknown };

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const CHANNEL = 'event';

export function publish(event: DomainEvent): void {
  emitter.emit(CHANNEL, event);
}

export function subscribe(handler: (event: DomainEvent) => void): () => void {
  emitter.on(CHANNEL, handler);
  return () => emitter.off(CHANNEL, handler);
}
