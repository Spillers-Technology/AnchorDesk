/**
 * Notification service: the bridge from domain events to per-user notifications.
 * It subscribes to the event bus, decides who should be told about each event,
 * persists a Notification row, then re-publishes a `notification.created` event
 * so the WebSocket hub delivers it live to that user's open tabs.
 *
 * Keeping this separate from the repositories means the write path stays unaware
 * of notification policy (Observer pattern) — change who-gets-told here only.
 */
import { prisma } from '../db/prisma';
import { subscribe, publish, DomainEvent } from './realtime/eventBus';
import * as notificationRepo from '../repositories/notificationRepository';

async function notify(userId: number, type: string, title: string, ticketId?: number, body?: string) {
  const notification = await notificationRepo.create({ userId, type, ticketId, title, body });
  publish({ type: 'notification.created', userId, notification });
}

async function ticketAssignee(ticketId: number): Promise<{ assigneeId: number | null; title: string } | null> {
  const t = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { assigneeId: true, title: true } });
  return t ? { assigneeId: t.assigneeId, title: t.title } : null;
}

async function handle(event: DomainEvent): Promise<void> {
  switch (event.type) {
    case 'ticket.updated': {
      const assigneeId = event.changes?.assigneeId as number | null | undefined;
      const prev = event.changes?.prevAssigneeId as number | null | undefined;
      if (assigneeId && assigneeId !== prev) {
        const t = event.ticket as { title?: string };
        await notify(assigneeId, 'assigned', `Ticket #${event.ticketId} assigned to you`, event.ticketId, t?.title);
      }
      break;
    }
    case 'note.added': {
      const info = await ticketAssignee(event.ticketId);
      if (!info?.assigneeId) break;
      const note = event.note as { authorId?: number | null; noteType?: string; direction?: string };
      if (note.authorId && note.authorId === info.assigneeId) break; // don't notify your own note
      const isReply = note.noteType === 'email' && note.direction === 'inbound';
      const label = isReply ? 'New customer reply' : 'New note';
      await notify(info.assigneeId, isReply ? 'reply' : 'note', `${label} on #${event.ticketId}`, event.ticketId, info.title);
      break;
    }
    case 'feedback.submitted': {
      const info = await ticketAssignee(event.ticketId);
      if (!info?.assigneeId) break;
      await notify(
        info.assigneeId,
        'feedback',
        `New customer feedback on #${event.ticketId}`,
        event.ticketId,
        info.title,
      );
      break;
    }
    case 'sla.atRisk': {
      const info = await ticketAssignee(event.ticketId);
      if (!info?.assigneeId) break;
      const verb = event.level === 'breached' ? 'breached' : 'is at risk';
      await notify(
        info.assigneeId,
        `sla-${event.level}`,
        `SLA ${event.kind} ${verb} on #${event.ticketId}`,
        event.ticketId,
        info.title,
      );
      break;
    }
    default:
      break;
  }
}

let started = false;

/** Subscribe to the event bus. Call once at boot. */
export function initNotificationService(): void {
  if (started) return;
  started = true;
  subscribe((event) => {
    handle(event).catch(() => {
      /* notification failures must never break the originating write */
    });
  });
}
