/**
 * Writes for sync scope: owning, detaching, resuming and pinning tickets.
 * Every state change leaves three traces — the ticket columns, an audit row,
 * and a note on the ticket's timeline — because "why did this stop syncing?"
 * must be answerable from the ticket itself. See docs/roadmap-sync-scope.md.
 */

import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import * as noteRepo from './noteRepository';
import { publish } from '../services/realtime/eventBus';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** An internal timeline note authored by sync itself. Never queued outbound. */
async function syncNote(ticketId: number, headline: string, detail: string) {
  await noteRepo.create(
    ticketId,
    {
      content: `${headline}\n\n${detail}`,
      htmlContent: `<p><strong>${escape(headline)}</strong></p><p>${escape(detail)}</p>`,
      author: 'AnchorDesk sync',
      noteType: 'internal',
      visibility: 'internal',
      via: 'sync',
    },
    'system',
  );
}

/** Record this job as owner of rows that don't have one yet. */
export async function adopt(ticketIds: number[], jobId: number): Promise<number> {
  if (ticketIds.length === 0) return 0;
  const res = await prisma.ticket.updateMany({
    where: { id: { in: ticketIds }, syncJobId: null },
    data: { syncJobId: jobId },
  });
  return res.count;
}

/**
 * Stop syncing a ticket that left its job's filter. Keeps the local copy and
 * remembers the revision at detach time, so a later resume knows whether the
 * ticket was edited while it wasn't syncing. Returns false if it was already
 * detached (a concurrent run got there first).
 */
export async function detach(input: {
  ticketId: number;
  jobId: number;
  jobName: string;
  reason: string;
  actor?: string;
}): Promise<boolean> {
  const actor = input.actor ?? 'system';
  const detachedAt = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.ticket.findUnique({
      where: { id: input.ticketId },
      select: { syncState: true, syncRevision: true },
    });
    if (!before || before.syncState === 'detached') return null;
    const ticket = await tx.ticket.update({
      where: { id: input.ticketId },
      data: {
        syncState: 'detached',
        syncDetachedAt: detachedAt,
        syncDetachReason: input.reason,
        syncDetachedRevision: before.syncRevision,
        syncJobId: input.jobId,
      },
    });
    await audit.record({
      entityType: 'ticket',
      entityId: input.ticketId,
      action: 'sync',
      changedBy: actor,
      oldValue: { syncState: before.syncState },
      newValue: { syncState: 'detached', syncJob: input.jobName, reason: input.reason },
    }, tx);
    return ticket;
  });
  if (!updated) return false;

  await syncNote(
    input.ticketId,
    `Sync stopped — this ticket left the scope of sync job “${input.jobName}”.`,
    `Why: ${input.reason}. The local copy is kept and can still be edited, but changes no longer ` +
      'travel in either direction. It resumes on its own if it comes back into scope, or you can ' +
      'request a sync bypass and an admin can keep it syncing anyway.',
  );
  publish({
    type: 'ticket.updated',
    ticketId: input.ticketId,
    ticket: updated,
    actor,
    changes: { syncState: 'detached', syncDetachReason: input.reason },
  });
  return true;
}

/**
 * Put a detached ticket back into sync. If it was edited locally while
 * detached it is marked pending, so reconcile applies the ordinary rules:
 * remote-only changes pull, local-only changes push, both → held conflict.
 */
export async function resume(input: {
  ticketId: number;
  why: 'back-in-scope' | 'bypass-approved' | 'sent-to-psa';
  jobName?: string | null;
  actor?: string;
  detail?: string;
}): Promise<boolean> {
  const actor = input.actor ?? 'system';
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.ticket.findUnique({
      where: { id: input.ticketId },
      select: { syncState: true, syncRevision: true, syncDetachedRevision: true, syncDetachReason: true },
    });
    if (!before || before.syncState !== 'detached') return null;
    const editedWhileDetached = before.syncRevision > (before.syncDetachedRevision ?? before.syncRevision);
    const syncState = editedWhileDetached ? 'pending' : 'synced';
    const ticket = await tx.ticket.update({
      where: { id: input.ticketId },
      data: {
        syncState,
        syncDetachedAt: null,
        syncDetachReason: null,
        syncDetachedRevision: null,
      },
    });
    await audit.record({
      entityType: 'ticket',
      entityId: input.ticketId,
      action: 'sync',
      changedBy: actor,
      oldValue: { syncState: 'detached', reason: before.syncDetachReason },
      newValue: { syncState, resumedBecause: input.why },
    }, tx);
    return ticket;
  });
  if (!updated) return false;

  const job = input.jobName ? ` of sync job “${input.jobName}”` : '';
  const headline =
    input.why === 'back-in-scope'
      ? `Sync resumed — this ticket is back in the scope${job}.`
      : input.why === 'bypass-approved'
        ? 'Sync resumed — a sync bypass was approved.'
        : 'Sync resumed — this ticket was sent to the PSA.';
  await syncNote(input.ticketId, headline, input.detail ?? 'Changes made on either side while sync was stopped are reconciled on the next sync run.');
  publish({ type: 'ticket.updated', ticketId: input.ticketId, ticket: updated, actor, changes: { syncState: updated.syncState } });
  return true;
}

/** Keep syncing regardless of the job filter (approved bypass, or sent from AnchorDesk). */
export async function setPinned(ticketId: number, pinned: boolean, actor: string, why: string): Promise<void> {
  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.ticket.findUnique({ where: { id: ticketId }, select: { syncScopePinned: true } });
    if (!before || before.syncScopePinned === pinned) return null;
    const ticket = await tx.ticket.update({ where: { id: ticketId }, data: { syncScopePinned: pinned } });
    await audit.record({
      entityType: 'ticket',
      entityId: ticketId,
      action: 'sync',
      changedBy: actor,
      oldValue: { syncScopePinned: before.syncScopePinned },
      newValue: { syncScopePinned: pinned, why },
    }, tx);
    return ticket;
  });
  if (!updated) return;
  if (!pinned) {
    await syncNote(
      ticketId,
      'Sync bypass removed.',
      `${why} This ticket follows its sync job's filter again: if it's outside it, sync stops on the next run.`,
    );
  }
  publish({ type: 'ticket.updated', ticketId, ticket: updated, actor, changes: { syncScopePinned: pinned } });
}
