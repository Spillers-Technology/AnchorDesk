/**
 * mergeService — fold a duplicate ticket into the one being kept, reversibly.
 *
 * Governing decision (docs/roadmap-relations-2.6.md): **a merge is a local-record
 * operation and never pushes.** No provider call is made from this file — not a
 * close, not a comment, not a link. A merged source instead stops reconciling
 * (the guard lives in twoWaySync/syncService), and the caller must acknowledge
 * that in so many words before the merge is allowed to proceed.
 *
 * That is deliberately conservative. Jira has no merge primitive, so any push we
 * invented here would be a guess about what the shop meant, applied to a system
 * we cannot roll back. Mapping merge onto a real `duplicates` link is a 3.0 item
 * behind a per-connection policy.
 *
 * The source ticket is never deleted. Its number is already loose in email
 * subject tokens, external references, and browser history, and every one of
 * those has to keep resolving — see `resolveMergeTarget`.
 */

import { Prisma, Ticket } from '@prisma/client';
import { prisma } from '../../db/prisma';
import * as audit from '../../repositories/auditRepository';
import { publish } from '../realtime/eventBus';
import {
  MERGE_LEDGER_VERSION,
  MergeLedger,
  parseMergeLedger,
} from './mergeLedger';

/** A condition the operator may proceed through by acknowledging it explicitly. */
export interface MergeWarning {
  code: 'sync-stop' | 'cross-company';
  message: string;
}

/** A condition that cannot be acknowledged away. */
export interface MergeBlocker {
  code:
    | 'same-ticket'
    | 'source-missing'
    | 'target-missing'
    | 'already-merged'
    | 'target-descendant'
    | 'sync-conflict'
    | 'source-deleted'
    | 'target-deleted';
  message: string;
}

export interface MergePreview {
  source: TicketRef;
  target: TicketRef;
  moves: {
    notes: number;
    attachments: number;
    checklistItems: number;
    children: number;
    labels: number;
    deviceLinks: number;
  };
  warnings: MergeWarning[];
  blockers: MergeBlocker[];
}

export interface TicketRef {
  id: number;
  ticketNumber: string | null;
  title: string;
  status: string;
}

export class MergeBlockedError extends Error {
  constructor(readonly blockers: MergeBlocker[]) {
    super(blockers.map((b) => b.message).join('; '));
    this.name = 'MergeBlockedError';
  }
}

export class MergeAcknowledgementRequiredError extends Error {
  constructor(readonly requiresAcknowledgement: string[]) {
    super(`merge requires explicit acknowledgement: ${requiresAcknowledgement.join(', ')}`);
    this.name = 'MergeAcknowledgementRequiredError';
  }
}

/** Depth cap when walking a merge chain. Merging into a descendant and merging
 *  into self are both rejected, so a cycle should be unreachable — but this
 *  resolves on the inbound-mail hot path, where an infinite loop would wedge the
 *  poller on a poison message. Fail closed instead. */
const MERGE_CHAIN_MAX_DEPTH = 16;

function ref(t: Pick<Ticket, 'id' | 'ticketNumber' | 'title' | 'status'>): TicketRef {
  return { id: t.id, ticketNumber: t.ticketNumber, title: t.title, status: t.status };
}

/**
 * Follow `mergedIntoId` to the ticket that is actually alive.
 *
 * Every inbound-mail thread-resolution path funnels through here. Without it, a
 * customer replying to the thread you just merged away opens correspondence on a
 * closed tombstone nobody is watching — the most likely real-world regression in
 * the whole feature.
 *
 * Chains are walked rather than path-compressed: rewriting older tombstones to
 * point at the newest survivor would make each merge's undo ledger describe a
 * state that no longer exists.
 */
export async function resolveMergeTarget(ticketId: number): Promise<number> {
  let current = ticketId;
  const seen = new Set<number>([current]);
  for (let hop = 0; hop < MERGE_CHAIN_MAX_DEPTH; hop++) {
    const row = await prisma.ticket.findUnique({
      where: { id: current },
      select: { mergedIntoId: true },
    });
    const next = row?.mergedIntoId;
    if (!next) return current;
    // A cycle is not supposed to be constructible; if one exists anyway, stop on
    // the last sane ticket rather than looping or throwing on the mail path.
    if (seen.has(next)) return current;
    seen.add(next);
    current = next;
  }
  return current;
}

/** True when the candidate is the source itself or anywhere beneath it. */
async function isSelfOrDescendant(candidateId: number, sourceId: number): Promise<boolean> {
  if (candidateId === sourceId) return true;
  let current: number | null = candidateId;
  for (let hop = 0; hop < MERGE_CHAIN_MAX_DEPTH; hop++) {
    const row: { parentId: number | null } | null = await prisma.ticket.findUnique({
      where: { id: current as number },
      select: { parentId: true },
    });
    current = row?.parentId ?? null;
    if (current === null) return false;
    if (current === sourceId) return true;
  }
  return false;
}

/** Does this ticket have a remote we could actually write a queued note to? */
function hasWritableRemote(t: Ticket): boolean {
  return Boolean(t.externalId && t.externalProvider);
}

/**
 * Everything the merge would do, plus why it might refuse. Modelled on the 2.4
 * automation preview: the operator sees the consequences before consenting, and
 * the same evaluation runs again inside the merge transaction.
 */
export async function previewMerge(sourceId: number, targetId: number): Promise<MergePreview> {
  const [source, rawTarget] = await Promise.all([
    prisma.ticket.findUnique({ where: { id: sourceId } }),
    prisma.ticket.findUnique({ where: { id: targetId } }),
  ]);

  const blockers: MergeBlocker[] = [];
  if (!source) blockers.push({ code: 'source-missing', message: `ticket ${sourceId} does not exist` });
  if (!rawTarget) blockers.push({ code: 'target-missing', message: `ticket ${targetId} does not exist` });
  if (!source || !rawTarget) {
    throw new MergeBlockedError(blockers);
  }

  // Merging into a tombstone means the survivor. Pretending otherwise is a worse
  // answer than just doing it.
  const resolvedTargetId = await resolveMergeTarget(rawTarget.id);
  const target =
    resolvedTargetId === rawTarget.id
      ? rawTarget
      : ((await prisma.ticket.findUnique({ where: { id: resolvedTargetId } })) ?? rawTarget);

  if (source.id === target.id) {
    blockers.push({ code: 'same-ticket', message: 'a ticket cannot be merged into itself' });
  }
  if (source.mergedIntoId) {
    blockers.push({
      code: 'already-merged',
      message: `ticket is already merged into #${source.mergedIntoId}`,
    });
  }
  if (source.status === 'Deleted') {
    blockers.push({ code: 'source-deleted', message: 'a deleted ticket cannot be merged' });
  }
  if (target.status === 'Deleted') {
    blockers.push({ code: 'target-deleted', message: 'cannot merge into a deleted ticket' });
  }
  // A merge must not become a way to bury an unresolved conflict.
  if (source.syncState === 'conflict') {
    blockers.push({
      code: 'sync-conflict',
      message: 'resolve this ticket’s sync conflict before merging it',
    });
  }
  if (source.id !== target.id && (await isSelfOrDescendant(target.id, source.id))) {
    blockers.push({
      code: 'target-descendant',
      message: 'cannot merge a ticket into one of its own children',
    });
  }

  const warnings: MergeWarning[] = [];
  if (hasWritableRemote(source)) {
    const label = source.externalId ?? 'the remote issue';
    const providerName = source.externalProvider ?? 'the external system';
    warnings.push({
      code: 'sync-stop',
      message:
        `${label} stays open in ${providerName}. AnchorDesk will stop syncing it. ` +
        `The remote issue is not closed, commented on, or linked by this merge.`,
    });
  }
  if (source.companyId && target.companyId && source.companyId !== target.companyId) {
    warnings.push({
      code: 'cross-company',
      message:
        `These tickets belong to different companies ` +
        `(${source.companyName ?? 'unknown'} → ${target.companyName ?? 'unknown'}). ` +
        `The conversation will move to ${target.companyName ?? 'the target company'}.`,
    });
  }

  const [notes, attachments, checklistItems, children, sourceLabels, targetLabels, sourceDevices, targetDevices] =
    await Promise.all([
      prisma.note.count({ where: { ticketId: source.id } }),
      prisma.attachment.count({ where: { ticketId: source.id } }),
      prisma.checklistItem.count({ where: { ticketId: source.id } }),
      prisma.ticket.count({ where: { parentId: source.id } }),
      prisma.ticketLabel.findMany({ where: { ticketId: source.id }, select: { labelId: true } }),
      prisma.ticketLabel.findMany({ where: { ticketId: target.id }, select: { labelId: true } }),
      prisma.deviceLink.findMany({ where: { ticketId: source.id }, select: { deviceId: true } }),
      prisma.deviceLink.findMany({ where: { ticketId: target.id }, select: { deviceId: true } }),
    ]);

  const targetLabelIds = new Set(targetLabels.map((l) => l.labelId));
  const targetDeviceIds = new Set(targetDevices.map((d) => d.deviceId));

  return {
    source: ref(source),
    target: ref(target),
    moves: {
      notes,
      attachments,
      checklistItems,
      children,
      labels: sourceLabels.filter((l) => !targetLabelIds.has(l.labelId)).length,
      deviceLinks: sourceDevices.filter((d) => !targetDeviceIds.has(d.deviceId)).length,
    },
    warnings,
    blockers,
  };
}

export interface MergeOptions {
  /** Warning codes the caller has explicitly consented to. */
  acknowledge?: string[];
}

/**
 * Perform the merge. One transaction: either every row moves and the ledger is
 * written, or nothing happens.
 */
export async function mergeTickets(
  sourceId: number,
  targetId: number,
  actorSub: string,
  options: MergeOptions = {}
): Promise<Ticket> {
  const preview = await previewMerge(sourceId, targetId);
  if (preview.blockers.length) throw new MergeBlockedError(preview.blockers);

  const acknowledged = new Set(options.acknowledge ?? []);
  const unacknowledged = preview.warnings.map((w) => w.code).filter((code) => !acknowledged.has(code));
  if (unacknowledged.length) throw new MergeAcknowledgementRequiredError(unacknowledged);

  const resolvedTargetId = preview.target.id;

  const merged = await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction and lock both rows. Preview ran outside it,
    // so without this a concurrent merge of the same source could double-move
    // rows, and a concurrent reparent could re-open the descendant cycle the
    // blocker check just ruled out.
    const rows = await tx.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`SELECT id FROM tickets WHERE id IN (${sourceId}, ${resolvedTargetId}) ORDER BY id FOR UPDATE`
    );
    if (rows.length !== 2) throw new MergeBlockedError([
      { code: 'target-missing', message: 'a ticket in this merge disappeared before it could complete' },
    ]);

    const source = await tx.ticket.findUniqueOrThrow({ where: { id: sourceId } });
    const target = await tx.ticket.findUniqueOrThrow({ where: { id: resolvedTargetId } });
    if (source.mergedIntoId) {
      throw new MergeBlockedError([
        { code: 'already-merged', message: `ticket is already merged into #${source.mergedIntoId}` },
      ]);
    }
    // Re-checked under the lock, not just in preview: someone could have made
    // the target a child of the source in between. Because hierarchy is exactly
    // one level, "target is a descendant of source" reduces to this one
    // comparison — and getting it wrong would reparent the target onto itself.
    if (target.parentId === sourceId) {
      throw new MergeBlockedError([
        { code: 'target-descendant', message: 'cannot merge a ticket into one of its own children' },
      ]);
    }

    const noteRows = await tx.note.findMany({
      where: { ticketId: sourceId },
      select: { id: true, syncPending: true },
    });
    const attachmentRows = await tx.attachment.findMany({
      where: { ticketId: sourceId },
      select: { id: true },
    });
    const checklistRows = await tx.checklistItem.findMany({
      where: { ticketId: sourceId },
      select: { id: true, sortOrder: true },
    });
    const childRows = await tx.ticket.findMany({
      where: { parentId: sourceId },
      select: { id: true },
    });
    const sourceLabels = await tx.ticketLabel.findMany({
      where: { ticketId: sourceId },
      select: { labelId: true },
    });
    const targetLabels = await tx.ticketLabel.findMany({
      where: { ticketId: resolvedTargetId },
      select: { labelId: true },
    });
    const sourceDevices = await tx.deviceLink.findMany({
      where: { ticketId: sourceId },
      select: { deviceId: true },
    });
    const targetDevices = await tx.deviceLink.findMany({
      where: { ticketId: resolvedTargetId },
      select: { deviceId: true },
    });

    const targetLabelIds = new Set(targetLabels.map((l) => l.labelId));
    const targetDeviceIds = new Set(targetDevices.map((d) => d.deviceId));
    const addedLabelIds = sourceLabels.map((l) => l.labelId).filter((id) => !targetLabelIds.has(id));
    const addedDeviceIds = sourceDevices.map((d) => d.deviceId).filter((id) => !targetDeviceIds.has(id));

    // A note still queued for the SOURCE's remote, moved onto a target with no
    // writable remote, would keep syncPending forever with nothing that could
    // ever drain it. Clear those, and record them so unmerge restores the queue.
    const clearedSyncPendingNoteIds = hasWritableRemote(target)
      ? []
      : noteRows.filter((n) => n.syncPending).map((n) => n.id);

    const noteIds = noteRows.map((n) => n.id);
    const attachmentIds = attachmentRows.map((a) => a.id);
    const childIds = childRows.map((c) => c.id);

    // Append the source's checklist after the target's existing items rather
    // than interleaving by the sort order each list had independently.
    const maxSort = await tx.checklistItem.aggregate({
      where: { ticketId: resolvedTargetId },
      _max: { sortOrder: true },
    });
    const sortBase = (maxSort._max.sortOrder ?? 0) + 1;

    if (noteIds.length) {
      await tx.note.updateMany({
        where: { id: { in: noteIds } },
        // originTicketId only when it is not already set: a note that has moved
        // twice should still name where it was authored, not the intermediate
        // stop.
        data: { ticketId: resolvedTargetId },
      });
      await tx.note.updateMany({
        where: { id: { in: noteIds }, originTicketId: null },
        data: { originTicketId: sourceId },
      });
    }
    if (clearedSyncPendingNoteIds.length) {
      await tx.note.updateMany({
        where: { id: { in: clearedSyncPendingNoteIds } },
        data: { syncPending: false },
      });
    }
    if (attachmentIds.length) {
      await tx.attachment.updateMany({
        where: { id: { in: attachmentIds } },
        data: { ticketId: resolvedTargetId },
      });
    }
    for (const item of checklistRows) {
      await tx.checklistItem.update({
        where: { id: item.id },
        data: { ticketId: resolvedTargetId, sortOrder: sortBase + item.sortOrder },
      });
    }
    if (childIds.length) {
      await tx.ticket.updateMany({
        where: { id: { in: childIds } },
        data: { parentId: resolvedTargetId },
      });
    }
    if (addedLabelIds.length) {
      await tx.ticketLabel.createMany({
        data: addedLabelIds.map((labelId) => ({ ticketId: resolvedTargetId, labelId })),
        skipDuplicates: true,
      });
    }
    if (addedDeviceIds.length) {
      await tx.deviceLink.createMany({
        data: addedDeviceIds.map((deviceId) => ({ ticketId: resolvedTargetId, deviceId })),
        skipDuplicates: true,
      });
    }
    await tx.ticketLabel.deleteMany({ where: { ticketId: sourceId } });
    await tx.deviceLink.deleteMany({ where: { ticketId: sourceId } });

    const ledger: MergeLedger = {
      version: MERGE_LEDGER_VERSION,
      noteIds,
      attachmentIds,
      checklistItems: checklistRows.map((c) => ({ id: c.id, sortOrder: c.sortOrder })),
      childIds,
      addedLabelIds,
      addedDeviceIds,
      clearedSyncPendingNoteIds,
      source: {
        status: source.status,
        closedAt: source.closedAt ? source.closedAt.toISOString() : null,
        syncState: source.syncState ?? null,
        parentId: source.parentId,
      },
    };

    const now = new Date();
    // `Closed` is an existing vocabulary value on purpose — merge adds nothing to
    // ticketVocab.ts, so Kanban columns, saved views, and automation conditions
    // are untouched. `mergedIntoId != null` carries the meaning.
    const updated = await tx.ticket.update({
      where: { id: sourceId },
      data: {
        mergedIntoId: resolvedTargetId,
        mergedAt: now,
        status: 'Closed',
        closedAt: source.closedAt ?? now,
        parentId: null,
      },
    });

    await tx.ticketMerge.create({
      data: {
        sourceId,
        targetId: resolvedTargetId,
        actor: actorSub,
        mergedAt: now,
        undoPlan: ledger as unknown as Prisma.InputJsonValue,
      },
    });

    await audit.record(
      {
        entityType: 'ticket',
        entityId: sourceId,
        action: 'merge',
        changedBy: actorSub,
        oldValue: source as unknown as Record<string, unknown>,
        newValue: updated as unknown as Record<string, unknown>,
      },
      tx
    );
    await audit.record(
      {
        entityType: 'ticket',
        entityId: resolvedTargetId,
        // Same action, recorded against the survivor too, so the target's own
        // history explains where its extra notes came from.
        action: 'merge',
        changedBy: actorSub,
        oldValue: target as unknown as Record<string, unknown>,
        newValue: { mergedFrom: sourceId, moved: ledger } as unknown as Record<string, unknown>,
      },
      tx
    );

    return updated;
  });

  // A distinct event type: automations must be able to tell a merge apart from
  // an ordinary close, or a bulk cleanup becomes a notification storm.
  publish({
    type: 'ticket.updated',
    ticketId: sourceId,
    ticket: merged,
    actor: actorSub,
    changes: { mergedIntoId: resolvedTargetId },
  });
  const survivor = await prisma.ticket.findUnique({ where: { id: resolvedTargetId } });
  publish({
    type: 'ticket.updated',
    ticketId: resolvedTargetId,
    ticket: survivor,
    actor: actorSub,
    changes: { mergedFrom: sourceId },
  });

  return merged;
}

/**
 * Reverse a merge by replaying its ledger exactly.
 *
 * Only rows the merge itself moved come back. Anything added to the target
 * afterwards stays on the target — the behaviour people expect, and the only one
 * the ledger can honestly promise.
 */
export async function unmergeTicket(sourceId: number, actorSub: string): Promise<Ticket> {
  return prisma.$transaction(async (tx) => {
    const source = await tx.ticket.findUnique({ where: { id: sourceId } });
    if (!source) {
      throw new MergeBlockedError([
        { code: 'source-missing', message: `ticket ${sourceId} does not exist` },
      ]);
    }
    if (!source.mergedIntoId) {
      throw new MergeBlockedError([
        { code: 'already-merged', message: 'ticket is not merged' },
      ]);
    }

    const record = await tx.ticketMerge.findFirst({
      where: { sourceId, unmergedAt: null },
      orderBy: { mergedAt: 'desc' },
    });
    if (!record) {
      throw new MergeBlockedError([
        {
          code: 'already-merged',
          message:
            'this merge has no undo record, so its exact contents cannot be restored; ' +
            'move the notes back by hand',
        },
      ]);
    }
    // Throws (MergeLedgerFormatError) rather than restoring part of a merge.
    const ledger = parseMergeLedger(record.undoPlan);

    if (ledger.noteIds.length) {
      await tx.note.updateMany({
        where: { id: { in: ledger.noteIds } },
        data: { ticketId: sourceId },
      });
      // Clear provenance only where THIS merge set it. A note that reached the
      // source via an earlier merge keeps naming where it was authored: with
      // A merged into B and then B into C, undoing B→C must leave that note
      // still attributed to A, not blanked as if it had always lived on B.
      await tx.note.updateMany({
        where: { id: { in: ledger.noteIds }, originTicketId: sourceId },
        data: { originTicketId: null },
      });
    }
    if (ledger.clearedSyncPendingNoteIds.length) {
      await tx.note.updateMany({
        where: { id: { in: ledger.clearedSyncPendingNoteIds }, externalId: null },
        data: { syncPending: true },
      });
    }
    if (ledger.attachmentIds.length) {
      await tx.attachment.updateMany({
        where: { id: { in: ledger.attachmentIds } },
        data: { ticketId: sourceId },
      });
    }
    for (const item of ledger.checklistItems) {
      await tx.checklistItem.updateMany({
        where: { id: item.id },
        data: { ticketId: sourceId, sortOrder: item.sortOrder },
      });
    }
    if (ledger.childIds.length) {
      await tx.ticket.updateMany({
        where: { id: { in: ledger.childIds } },
        data: { parentId: sourceId },
      });
    }
    if (ledger.addedLabelIds.length) {
      await tx.ticketLabel.deleteMany({
        where: { ticketId: record.targetId, labelId: { in: ledger.addedLabelIds } },
      });
      await tx.ticketLabel.createMany({
        data: ledger.addedLabelIds.map((labelId) => ({ ticketId: sourceId, labelId })),
        skipDuplicates: true,
      });
    }
    if (ledger.addedDeviceIds.length) {
      await tx.deviceLink.deleteMany({
        where: { ticketId: record.targetId, deviceId: { in: ledger.addedDeviceIds } },
      });
      await tx.deviceLink.createMany({
        data: ledger.addedDeviceIds.map((deviceId) => ({ ticketId: sourceId, deviceId })),
        skipDuplicates: true,
      });
    }

    const restored = await tx.ticket.update({
      where: { id: sourceId },
      data: {
        mergedIntoId: null,
        mergedAt: null,
        status: ledger.source.status,
        closedAt: ledger.source.closedAt ? new Date(ledger.source.closedAt) : null,
        parentId: ledger.source.parentId,
        // The ticket re-enters sync scope, so its baseline must be re-established
        // rather than trusted: the remote has been moving unobserved since the
        // merge. `pending` sends it through a full reconcile on the next run.
        syncState: source.externalId && source.externalProvider ? 'pending' : null,
        syncRevision: { increment: 1 },
      },
    });

    await tx.ticketMerge.update({
      where: { id: record.id },
      data: { unmergedAt: new Date() },
    });

    await audit.record(
      {
        entityType: 'ticket',
        entityId: sourceId,
        action: 'unmerge',
        changedBy: actorSub,
        oldValue: source as unknown as Record<string, unknown>,
        newValue: restored as unknown as Record<string, unknown>,
      },
      tx
    );

    publish({ type: 'ticket.updated', ticketId: sourceId, ticket: restored, actor: actorSub, changes: { mergedIntoId: null } });
    return restored;
  });
}
