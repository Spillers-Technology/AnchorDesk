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
    | 'target-would-nest'
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

/**
 * Depth cap when walking a merge chain. The `seen` set already guarantees
 * termination on its own, so this is a second backstop rather than the real
 * limit — which is why it is set well above any plausible chain (16 was low
 * enough that a legitimate sequence of merges could reach it, and hitting it
 * silently returns a tombstone). Kept because this runs on the inbound-mail hot
 * path, where an unbounded walk would wedge the poller on one poison message.
 */
const MERGE_CHAIN_MAX_DEPTH = 128;

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
    if (seen.has(next)) {
      console.error(
        `[merge] ticket ${ticketId}: merge chain cycles at #${next}; ` +
          `resolving to #${current}, which is still a tombstone. Correspondence will ` +
          `land on a closed ticket until this is repaired.`
      );
      return current;
    }
    seen.add(next);
    current = next;
  }
  // Only reachable on a chain longer than the cap. Say so loudly: the answer we
  // are about to return is a tombstone, which is exactly the outcome this
  // function exists to prevent.
  console.error(
    `[merge] ticket ${ticketId}: merge chain exceeded ${MERGE_CHAIN_MAX_DEPTH} hops; ` +
      `resolving to #${current}, which may still be a tombstone.`
  );
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

  // Merging a parent into a ticket that is itself a child would push the source's
  // children to depth 2, which the pgExtras trigger refuses. Caught here so the
  // operator gets an explanation in the preview instead of a raw constraint
  // violation from inside the merge transaction.
  if (children > 0 && target.parentId !== null) {
    blockers.push({
      code: 'target-would-nest',
      message:
        `#${source.ticketNumber ?? source.id} has ${children} child ticket(s) and ` +
        `#${target.ticketNumber ?? target.id} is itself a child ticket. ` +
        `AnchorDesk supports one level of hierarchy — detach one of them first.`,
    });
  }

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

  const mergeResult = await prisma.$transaction(async (tx) => {
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
    // The chain was resolved before the transaction, so the survivor we picked
    // may itself have been merged away in the meantime. Refuse rather than
    // resolve again here: two reciprocal merges (A→B and B→A) previewing at the
    // same time would otherwise both commit and build a merge cycle, and
    // re-resolving would silently retarget a merge the operator never approved.
    if (target.mergedIntoId) {
      throw new MergeBlockedError([
        {
          code: 'already-merged',
          message:
            `#${target.ticketNumber ?? target.id} was merged into #${target.mergedIntoId} ` +
            `while this merge was being prepared; re-run the preview`,
        },
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
    // Re-checked under the lock for the same reason as the descendant test: the
    // target could have been given a parent, or the source a child, since
    // preview ran. Without this the reparent below trips the one-level trigger
    // and the operator sees a raw constraint violation.
    if (childRows.length && target.parentId !== null) {
      throw new MergeBlockedError([
        {
          code: 'target-would-nest',
          message:
            'cannot merge a ticket with children into a ticket that is itself a child; ' +
            'AnchorDesk supports one level of hierarchy',
        },
      ]);
    }
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

    // Every move below is scoped by its ORIGINAL owner as well as by id. Only the
    // two ticket rows are locked, so a concurrent edit can move one of these rows
    // off the source between the read above and the write here; the extra
    // predicate makes such a row a no-op instead of yanking it away from
    // wherever it now lives.
    if (noteIds.length) {
      await tx.note.updateMany({
        where: { id: { in: noteIds }, ticketId: sourceId },
        // originTicketId only when it is not already set: a note that has moved
        // twice should still name where it was authored, not the intermediate
        // stop.
        data: { ticketId: resolvedTargetId },
      });
      await tx.note.updateMany({
        where: { id: { in: noteIds }, ticketId: resolvedTargetId, originTicketId: null },
        data: { originTicketId: sourceId },
      });
    }
    if (clearedSyncPendingNoteIds.length) {
      await tx.note.updateMany({
        where: { id: { in: clearedSyncPendingNoteIds }, ticketId: resolvedTargetId },
        data: { syncPending: false },
      });
    }
    if (attachmentIds.length) {
      await tx.attachment.updateMany({
        where: { id: { in: attachmentIds }, ticketId: sourceId },
        data: { ticketId: resolvedTargetId },
      });
    }
    for (const item of checklistRows) {
      await tx.checklistItem.updateMany({
        where: { id: item.id, ticketId: sourceId },
        data: { ticketId: resolvedTargetId, sortOrder: sortBase + item.sortOrder },
      });
    }
    if (childIds.length) {
      await tx.ticket.updateMany({
        where: { id: { in: childIds }, parentId: sourceId },
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
      // The full source sets, not just the added ones: the deletes below strip
      // every source association, so restoring only `added*` would permanently
      // lose any label/device the source and target both had.
      sourceLabelIds: sourceLabels.map((l) => l.labelId),
      sourceDeviceIds: sourceDevices.map((d) => d.deviceId),
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
        // The tombstone guard in twoWaySync is checked once, before the provider
        // round-trip. A reconcile already past that point would otherwise write
        // its result back over the ticket we just merged — its compare-and-set
        // matches on (id, syncRevision) alone. Bumping the revision here makes
        // any in-flight reconcile's write match zero rows and raise
        // TicketSyncRevisionConflictError instead of resurrecting the tombstone
        // or stamping it synced.
        syncRevision: { increment: 1 },
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

    const sourceAudit = await audit.record(
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

    return {
      updated,
      sourceStatus: source.status,
      auditId: sourceAudit?.id.toString(),
    };
  });
  const { updated: merged, sourceStatus, auditId } = mergeResult;

  // A distinct event type: automations must be able to tell a merge apart from
  // an ordinary close, or a bulk cleanup becomes a notification storm.
  publish({
    type: 'ticket.updated',
    ticketId: sourceId,
    ticket: merged,
    actor: actorSub,
    changes: { mergedIntoId: resolvedTargetId },
    auditId,
    metric: {
      context: {
        companyId: merged.companyId,
        teamId: merged.teamId,
        assigneeId: merged.assigneeId,
        priority: merged.priority,
        status: merged.status,
        occurredAt: merged.mergedAt ?? merged.updatedAt,
      },
      merge: { targetId: resolvedTargetId, fromStatus: sourceStatus },
    },
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
  const unmergeResult = await prisma.$transaction(async (tx) => {
    // Lock the tombstone first, for the same reason merge locks both rows: two
    // concurrent unmerges would otherwise both read a merged source, and the
    // slower one would clear a `mergedIntoId` written by a merge it knows
    // nothing about.
    await tx.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`SELECT id FROM tickets WHERE id = ${sourceId} FOR UPDATE`
    );

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
    // The ledger must describe the merge this ticket is actually in. If they
    // disagree, the rows moved somewhere other than where we are about to pull
    // them back from, and replaying it would scatter data rather than restore it.
    if (record && record.targetId !== source.mergedIntoId) {
      throw new MergeBlockedError([
        {
          code: 'already-merged',
          message:
            `this ticket is merged into #${source.mergedIntoId} but its undo record ` +
            `describes a merge into #${record.targetId}; restore it by hand`,
        },
      ]);
    }
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

    // Every restore is scoped to the target the merge moved these rows to. A
    // ledger id that names a row living anywhere else — because a later merge
    // moved it on, or because the JSON was edited by hand — is skipped rather
    // than stolen from its current owner.
    if (ledger.noteIds.length) {
      await tx.note.updateMany({
        where: { id: { in: ledger.noteIds }, ticketId: record.targetId },
        data: { ticketId: sourceId },
      });
      // Clear provenance only where THIS merge set it. A note that reached the
      // source via an earlier merge keeps naming where it was authored: with
      // A merged into B and then B into C, undoing B→C must leave that note
      // still attributed to A, not blanked as if it had always lived on B.
      await tx.note.updateMany({
        where: { id: { in: ledger.noteIds }, ticketId: sourceId, originTicketId: sourceId },
        data: { originTicketId: null },
      });
    }
    if (ledger.clearedSyncPendingNoteIds.length) {
      // Scoped to notes that actually came back: re-queueing a note still living
      // on the target would push it to the wrong remote.
      await tx.note.updateMany({
        where: { id: { in: ledger.clearedSyncPendingNoteIds }, ticketId: sourceId, externalId: null },
        data: { syncPending: true },
      });
    }
    if (ledger.attachmentIds.length) {
      await tx.attachment.updateMany({
        where: { id: { in: ledger.attachmentIds }, ticketId: record.targetId },
        data: { ticketId: sourceId },
      });
    }
    for (const item of ledger.checklistItems) {
      await tx.checklistItem.updateMany({
        where: { id: item.id, ticketId: record.targetId },
        data: { ticketId: sourceId, sortOrder: item.sortOrder },
      });
    }
    if (ledger.childIds.length) {
      await tx.ticket.updateMany({
        where: { id: { in: ledger.childIds }, parentId: record.targetId },
        data: { parentId: sourceId },
      });
    }
    // Two different sets, deliberately: strip from the target only what this
    // merge added to it, but give the source back everything it had. They differ
    // on the labels both tickets carried — which the merge deleted from the
    // source and which `addedLabelIds` alone would never restore.
    if (ledger.addedLabelIds.length) {
      await tx.ticketLabel.deleteMany({
        where: { ticketId: record.targetId, labelId: { in: ledger.addedLabelIds } },
      });
    }
    if (ledger.sourceLabelIds.length) {
      await tx.ticketLabel.createMany({
        data: ledger.sourceLabelIds.map((labelId) => ({ ticketId: sourceId, labelId })),
        skipDuplicates: true,
      });
    }
    if (ledger.addedDeviceIds.length) {
      await tx.deviceLink.deleteMany({
        where: { ticketId: record.targetId, deviceId: { in: ledger.addedDeviceIds } },
      });
    }
    if (ledger.sourceDeviceIds.length) {
      await tx.deviceLink.createMany({
        data: ledger.sourceDeviceIds.map((deviceId) => ({ ticketId: sourceId, deviceId })),
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

    const auditRow = await audit.record(
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

    return {
      restored,
      previousTargetId: record.targetId,
      fromStatus: source.status,
      auditId: auditRow?.id.toString(),
    };
  });
  const { restored, previousTargetId, fromStatus, auditId } = unmergeResult;

  // Published after commit, not inside the transaction: subscribers (and the
  // automation service, which re-reads the ticket) must never see a restore that
  // then rolls back, or query the row while it is still a tombstone.
  publish({
    type: 'ticket.updated',
    ticketId: sourceId,
    ticket: restored,
    actor: actorSub,
    changes: { mergedIntoId: null },
    auditId,
    metric: {
      context: {
        companyId: restored.companyId,
        teamId: restored.teamId,
        assigneeId: restored.assigneeId,
        priority: restored.priority,
        status: restored.status,
        occurredAt: restored.updatedAt,
      },
      unmerge: {
        previousTargetId,
        fromStatus,
        toStatus: restored.status,
      },
    },
  });
  return restored;
}
