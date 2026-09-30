/**
 * Sync bypass requests. A ticket that left its sync job's scope stops syncing
 * (syncScopeRepository.detach). Anyone who can edit tickets may ask for it to
 * keep syncing anyway; any admin may approve or reject. Approval pins the
 * ticket — it syncs regardless of the job's filter — and resumes it at once.
 *
 * The request row is the durable answer to "who let this ticket outside the
 * convention, and why", so decided requests are kept, never deleted.
 */

import { prisma } from '../db/prisma';
import * as notificationRepo from '../repositories/notificationRepository';
import * as scopeRepo from '../repositories/syncScopeRepository';
import * as audit from '../repositories/auditRepository';
import { publish } from './realtime/eventBus';

export class BypassError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
  }
}

export interface Requester {
  actor: string;
  userId: number | null;
  isAdmin: boolean;
}

async function notify(userIds: number[], title: string, ticketId: number, body: string) {
  for (const userId of userIds) {
    try {
      const notification = await notificationRepo.create({ userId, type: 'sync.bypass', ticketId, title, body });
      publish({ type: 'notification.created', userId, notification });
    } catch {
      // A notification is a courtesy; the request itself is already durable.
    }
  }
}

async function ticketLabel(ticketId: number): Promise<string> {
  const t = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { ticketNumber: true, title: true } });
  return t ? `#${t.ticketNumber ?? ticketId} ${t.title}` : `#${ticketId}`;
}

/**
 * Ask for a detached ticket to keep syncing. An admin asking is approved in
 * the same step — they could approve their own request anyway, and making them
 * click twice records nothing extra.
 */
export async function request(ticketId: number, reason: string, who: Requester) {
  const trimmed = reason.trim();
  if (!trimmed) throw new BypassError('say why this ticket should keep syncing', 400);

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, syncState: true, syncJobId: true },
  });
  if (!ticket) throw new BypassError('ticket not found', 404);
  if (ticket.syncState !== 'detached') {
    throw new BypassError('this ticket is still syncing; a bypass is only for tickets that left their sync scope', 409);
  }
  const open = await prisma.syncBypassRequest.findFirst({ where: { ticketId, status: 'pending' } });
  if (open && !who.isAdmin) throw new BypassError('a bypass request for this ticket is already waiting for an admin', 409);

  const row = open ?? await prisma.syncBypassRequest.create({
    data: { ticketId, reason: trimmed, requestedBy: who.actor, requestedById: who.userId },
  });
  await audit.record({
    entityType: 'ticket',
    entityId: ticketId,
    action: 'sync',
    changedBy: who.actor,
    newValue: { syncBypassRequested: row.id, reason: trimmed },
  });

  if (who.isAdmin) return decide(row.id, 'approved', who, open ? trimmed : undefined);

  const admins = await prisma.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } });
  await notify(
    admins.map((a) => a.id).filter((id) => id !== who.userId),
    'Sync bypass requested',
    ticketId,
    `${who.actor} asked to keep ${await ticketLabel(ticketId)} syncing: ${trimmed}`,
  );
  publish({ type: 'ticket.updated', ticketId, ticket: null, actor: who.actor, changes: { syncBypassRequest: 'pending' } });
  return row;
}

/** Approve or reject a pending request. Admins only (enforced by the route). */
export async function decide(requestId: number, decision: 'approved' | 'rejected', who: Requester, note?: string) {
  const row = await prisma.syncBypassRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new BypassError('bypass request not found', 404);
  if (row.status !== 'pending') throw new BypassError(`this request was already ${row.status}`, 409);

  const decided = await prisma.syncBypassRequest.update({
    where: { id: requestId },
    data: { status: decision, reviewedBy: who.actor, reviewedAt: new Date(), reviewNote: note?.trim() || null },
  });

  if (decision === 'approved') {
    await scopeRepo.setPinned(row.ticketId, true, who.actor, `Bypass request #${row.id} approved.`);
    await scopeRepo.resume({
      ticketId: row.ticketId,
      why: 'bypass-approved',
      actor: who.actor,
      detail:
        `Approved by ${who.actor}${row.requestedBy !== who.actor ? ` at ${row.requestedBy}'s request` : ''}: ${row.reason}. ` +
        "It keeps syncing even outside its job's filter until an admin removes the bypass.",
    });
  } else {
    await audit.record({
      entityType: 'ticket',
      entityId: row.ticketId,
      action: 'sync',
      changedBy: who.actor,
      newValue: { syncBypassRejected: row.id, note: note ?? null },
    });
  }

  if (row.requestedById && row.requestedById !== who.userId) {
    await notify(
      [row.requestedById],
      decision === 'approved' ? 'Sync bypass approved' : 'Sync bypass rejected',
      row.ticketId,
      `${who.actor} ${decision} your request for ${await ticketLabel(row.ticketId)}${note?.trim() ? `: ${note.trim()}` : '.'}`,
    );
  }
  publish({ type: 'ticket.updated', ticketId: row.ticketId, ticket: null, actor: who.actor, changes: { syncBypassRequest: decision } });
  return decided;
}

/** Remove an approved bypass: the ticket follows its job's filter again. */
export async function unpin(ticketId: number, who: Requester) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { syncScopePinned: true } });
  if (!ticket) throw new BypassError('ticket not found', 404);
  if (!ticket.syncScopePinned) throw new BypassError('this ticket has no sync bypass', 409);
  await scopeRepo.setPinned(ticketId, false, who.actor, `Removed by ${who.actor}.`);
}

/** Everything the ticket view shows about a ticket's place in its sync job. */
export async function scopeForTicket(ticketId: number) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      syncState: true,
      syncDetachReason: true,
      syncDetachedAt: true,
      syncScopePinned: true,
      syncJob: { select: { id: true, name: true, type: true } },
    },
  });
  if (!ticket) throw new BypassError('ticket not found', 404);
  const requests = await prisma.syncBypassRequest.findMany({ where: { ticketId }, orderBy: { requestedAt: 'desc' }, take: 20 });
  return {
    job: ticket.syncJob,
    detached: ticket.syncState === 'detached',
    detachReason: ticket.syncDetachReason,
    detachedAt: ticket.syncDetachedAt,
    pinned: ticket.syncScopePinned,
    requests,
  };
}

/** The admin queue: pending first, then recent decisions, with ticket context. */
export function listQueue(status?: 'pending' | 'approved' | 'rejected') {
  return prisma.syncBypassRequest.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
    take: 100,
    include: {
      ticket: {
        select: {
          id: true,
          ticketNumber: true,
          title: true,
          externalId: true,
          externalProvider: true,
          syncDetachReason: true,
          syncDetachedAt: true,
          syncJob: { select: { id: true, name: true } },
        },
      },
    },
  });
}
