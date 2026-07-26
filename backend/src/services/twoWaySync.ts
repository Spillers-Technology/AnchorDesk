/**
 * twoWaySync — reconciles a locally-stored external ticket with its source system
 * (ConnectWise / Jira) in both directions, with conflict detection.
 *
 * Model ("flag conflict & hold"):
 *   - A remote fingerprint (remoteHash) is stored at each clean reconcile.
 *   - Local edits to an external ticket mark it syncState = 'pending' (done in the
 *     route layer, not here, so inbound apply doesn't self-trigger).
 *   - reconcileTicket() compares: did the remote change since last sync
 *     (remoteHash differs), and is there a pending local change?
 *       both changed   → syncState 'conflict', auto-sync held for manual resolve
 *       remote only     → apply inbound (fields + new comments), mark synced
 *       local only      → push outbound (fields + unsynced notes), mark synced
 *       neither         → ensure a baseline hash is recorded
 *   - resolveConflict() lets a human pick a winning side, then syncs that way.
 *
 * The local DB stays the durable record; this only decides direction per ticket.
 */

import crypto from 'crypto';
import { Ticket } from '@prisma/client';
import { prisma } from '../db/prisma';
import {
  ExternalTicket,
  localVisibilityForExternalNote,
  TicketProvider,
} from '../providers/TicketProvider';
import { tryCreateTicketProviderFor } from '../providers/ticketProviderFactory';
import * as ticketRepo from '../repositories/ticketRepository';
import * as noteRepo from '../repositories/noteRepository';
import { publish } from './realtime/eventBus';
import {
  syncAccountKeyForTicket,
  withSyncAccountLock,
} from './syncAccountLock';

/** `merged` is distinct from `skipped` on purpose: skipping is a symptom (a
 *  misconfigured or non-two-way provider) and degrades the run's health, whereas
 *  a merged tombstone being left alone is the design working. Collapsing the two
 *  would leave every run permanently "degraded" for as long as one merged ticket
 *  stayed inside the job's scope. */
export type ReconcileOutcome =
  | 'synced'
  | 'pushed'
  | 'pulled'
  | 'conflict'
  | 'error'
  | 'skipped'
  | 'merged';

export interface ReconcileResult {
  ticketId: number;
  outcome: ReconcileOutcome;
  message?: string;
  /** New remote comments inserted locally during this reconcile. */
  notesUpserted?: number;
}

class ConcurrentLocalEditDuringInbound extends Error {}

export interface SyncFields {
  status?: string;
  priority?: string;
  assignee?: string;
  title?: string;
  description?: string;
}

export const ALL_SYNC_FIELDS = ['status', 'priority', 'assignee', 'title', 'description'] as const;

/**
 * Fingerprint the writeback-relevant fields; order-stable, whitespace-normalized.
 *
 * `fields` narrows the comparison. Remote-change detection uses every field, but
 * verifying that a push landed must only consider fields the provider can
 * actually write — otherwise ConnectWise, which ignores title/description, would
 * report every successful push as a failure.
 */
export function fingerprint(
  t: SyncFields,
  fields: ReadonlyArray<keyof SyncFields> = ALL_SYNC_FIELDS
): string {
  const norm = fields
    .map((f) => t[f])
    .map((s) => (s ?? '').trim())
    .join('');
  return crypto.createHash('sha256').update(norm).digest('hex');
}

/** Reconcile one external ticket. Pass `remote` to reuse an already-fetched
 *  payload (batch sync) and skip the extra getTicket round-trip. */
export async function reconcileTicket(
  ticketId: number,
  opts: { remote?: ExternalTicket; actor?: string } = {}
): Promise<ReconcileResult> {
  const identity = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { externalProvider: true, syncConnectionId: true },
  });
  const accountKey = syncAccountKeyForTicket(
    identity?.externalProvider ?? null,
    identity?.syncConnectionId ?? null
  );
  if (!accountKey) return reconcileTicketWithinAccountLock(ticketId, opts);
  return withSyncAccountLock(accountKey, () =>
    reconcileTicketWithinAccountLock(ticketId, opts)
  );
}

/**
 * Reconcile while the caller already owns the account lock. Batch sync uses
 * this entry point so each ticket does not try to re-acquire its run's lock.
 */
export async function reconcileTicketWithinAccountLock(
  ticketId: number,
  opts: { remote?: ExternalTicket; actor?: string } = {}
): Promise<ReconcileResult> {
  const actor = opts.actor ?? 'system';
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) return { ticketId, outcome: 'skipped', message: 'ticket not found' };
  if (!ticket.externalId || !ticket.externalProvider) {
    return { ticketId, outcome: 'skipped', message: 'not an external ticket' };
  }

  const provider = await tryCreateTicketProviderFor(ticket.externalProvider, ticket.syncConnectionId);
  if (!provider || !provider.canWriteBack || !provider.getTicket) {
    return { ticketId, outcome: 'skipped', message: 'provider is not two-way capable' };
  }

  // A merged ticket is a tombstone: its conversation now lives on the survivor,
  // and a merge deliberately makes no remote change (see mergeService). Applying
  // inbound here would reopen a ticket the operator closed by merging it, and
  // pushing would send the survivor's state to the wrong issue. Only unmerge
  // returns it to scope, and that re-establishes the baseline from scratch.
  if (ticket.mergedIntoId) {
    return {
      ticketId,
      outcome: 'merged',
      message: `merged into #${ticket.mergedIntoId}; local record only`,
    };
  }

  // A held conflict is a hard stop: only resolveConflict() may move a ticket out
  // of it. Without this the next reconcile saw syncState 'conflict' (so
  // localPending was false) while the remote still differed from the stale
  // baseline, took the remote-only branch, and silently overwrote the local edit
  // the conflict existed to protect.
  if (ticket.syncState === 'conflict') {
    return { ticketId, outcome: 'conflict', message: 'held for manual resolution' };
  }

  let remote: ExternalTicket | null;
  try {
    remote = opts.remote ?? (await provider.getTicket(ticket.externalId));
  } catch (err) {
    await ticketRepo.setSyncStateIfRevision(ticketId, ticket.syncRevision, 'error');
    return { ticketId, outcome: 'error', message: (err as Error).message };
  }
  if (!remote) {
    await ticketRepo.setSyncStateIfRevision(ticketId, ticket.syncRevision, 'error');
    return { ticketId, outcome: 'error', message: 'remote ticket not found' };
  }

  const remoteHash = fingerprint(remote);
  // First reconcile (no baseline) never counts as a remote change, so a fresh
  // ingest can't be mistaken for a conflict.
  const remoteChanged = ticket.remoteHash != null && ticket.remoteHash !== remoteHash;
  // 'error' means a previous push failed, so the local edit is still unsynced.
  // Treating it as clean let the next run either mark it synced or pull the
  // remote over it, dropping the local change that failed to push.
  const pendingNote = await prisma.note.findFirst({
    where: { ticketId, syncPending: true },
    select: { id: true },
  });
  const localFieldPending = ticket.syncState === 'pending' || ticket.syncState === 'error';

  try {
    if (remoteChanged && localFieldPending) {
      const held = await ticketRepo.setSyncStateIfRevision(ticketId, ticket.syncRevision, 'conflict', {
        remoteUpdatedAt: remote.updatedAt ?? null,
      });
      if (!held) {
        await ticketRepo.markConflictAfterConcurrentLocalEdit(
          ticketId,
          ticket.syncRevision,
          remote.updatedAt ?? null
        );
      }
      publish({ type: 'ticket.updated', ticketId, ticket, actor, changes: { syncState: 'conflict' } });
      return { ticketId, outcome: 'conflict' };
    }

    if (remoteChanged) {
      try {
        const notesUpserted = await applyInbound(ticket, remote, provider, actor);
        // Append-only comments commute with inbound field changes. A queued note
        // alone must not manufacture a field conflict when the remote status or
        // priority changed at the same time.
        if (pendingNote) {
          try {
            await pushUnsyncedNotes(ticket, provider);
          } catch (err) {
            return {
              ticketId,
              outcome: 'error',
              message: `remote fields pulled, but queued note push failed: ${(err as Error).message}`,
              notesUpserted,
            };
          }
        }
        return { ticketId, outcome: 'pulled', notesUpserted };
      } catch (err) {
        if (err instanceof ConcurrentLocalEditDuringInbound) {
          return {
            ticketId,
            outcome: 'conflict',
            message: 'ticket changed locally during inbound reconcile; held for manual resolution',
          };
        }
        throw err;
      }
    }

    if (localFieldPending) {
      const fresh = await verifiedPush(ticket, remote, provider);

      // Commit the reconciled field baseline BEFORE pulling notes. Notes are an
      // independently retryable step; leaving the old baseline in place while a
      // note fetch failed made the next run read our own successful push as a
      // remote edit and raise a false conflict.
      const stamped = await ticketRepo.setSyncStateIfRevision(ticketId, ticket.syncRevision, 'synced', {
        remoteHash: fingerprint(fresh),
        remoteUpdatedAt: fresh.updatedAt ?? null,
        syncedAt: new Date(),
      });
      if (!stamped) {
        await ticketRepo.advanceRemoteBaselineWhilePending(ticketId, ticket.syncRevision, {
          remoteHash: fingerprint(fresh),
          remoteUpdatedAt: fresh.updatedAt ?? null,
          syncedAt: new Date(),
        });
        return {
          ticketId,
          outcome: 'skipped',
          message: 'ticket changed locally during outbound reconcile; latest edit remains queued',
        };
      }
      publish({ type: 'ticket.updated', ticketId, ticket, actor, changes: { syncState: 'synced' } });

      const notesUpserted = await pullNotes(ticket, provider);
      return { ticketId, outcome: 'pushed', notesUpserted };
    }

    if (pendingNote) {
      try {
        await pushUnsyncedNotes(ticket, provider);
      } catch (err) {
        // The Note.syncPending row is the retry record. Do not turn a
        // comment-only failure into field-level `error`, which would create a
        // false conflict if remote fields move before the retry.
        return { ticketId, outcome: 'error', message: (err as Error).message };
      }
      const stamped = await ticketRepo.setSyncStateIfRevision(ticketId, ticket.syncRevision, 'synced', {
        remoteHash,
        remoteUpdatedAt: remote.updatedAt ?? null,
        syncedAt: ticket.syncedAt ?? new Date(),
      });
      if (!stamped) {
        return {
          ticketId,
          outcome: 'skipped',
          message: 'ticket fields changed locally after its queued note was sent; field edit remains queued',
        };
      }
      const notesUpserted = await pullNotes(ticket, provider);
      return { ticketId, outcome: 'pushed', notesUpserted };
    }

    // No field-level change. Baseline first, then comments — same reasoning as
    // above. Comments still need pulling: a comment-only remote update bumps
    // Jira's `updated` (so the ticket reaches us) but leaves the field
    // fingerprint identical, and a freshly imported ticket has no notes at all
    // until its first reconcile.
    const stamped = await ticketRepo.setSyncStateIfRevision(ticketId, ticket.syncRevision, 'synced', {
      remoteHash,
      remoteUpdatedAt: remote.updatedAt ?? null,
      syncedAt: ticket.syncedAt ?? new Date(),
    });
    if (!stamped) {
      return {
        ticketId,
        outcome: 'skipped',
        message: 'ticket changed locally during reconcile; latest edit remains queued',
      };
    }
    const notesUpserted = await pullNotes(ticket, provider);
    return { ticketId, outcome: 'synced', notesUpserted };
  } catch (err) {
    await ticketRepo.setSyncStateIfRevision(ticketId, ticket.syncRevision, 'error');
    return { ticketId, outcome: 'error', message: (err as Error).message };
  }
}

/**
 * Push local state out, re-read, and confirm the writable fields actually
 * landed. Throws on any failure so the caller records `error` rather than a
 * clean baseline over a divergence. Returns the verified remote state.
 *
 * Shared by normal reconcile and `resolveConflict('local')` — the manual path
 * used to skip verification entirely, which is the path where getting it wrong
 * matters most.
 */
async function verifiedPush(
  ticket: Ticket,
  remote: ExternalTicket,
  provider: TicketProvider
): Promise<ExternalTicket> {
  await pushLocal(ticket, remote, provider);

  // A failed re-read is a genuine failure, not licence to fall back to the
  // stale pre-push snapshot.
  const fresh = await provider.getTicket!(ticket.externalId!);
  if (!fresh) throw new Error('could not re-read remote after push');

  // Verify only the fields this provider claims it can write; comparing all
  // five would fail forever on a provider that ignores some of them.
  const writable = provider.writableFields ?? ALL_SYNC_FIELDS;
  if (fingerprint(fresh, writable) !== fingerprint(localSyncFields(ticket), writable)) {
    throw new Error('push did not take effect remotely (field mapping mismatch); left unsynced');
  }

  // Fields this provider cannot write are pull-only. If the local copy has
  // drifted from the remote on one of those, say so instead of recording a
  // clean baseline that hides the divergence forever.
  const unwritable = ALL_SYNC_FIELDS.filter((f) => !writable.includes(f));
  const drifted = unwritable.filter(
    (f) => fingerprint(fresh, [f]) !== fingerprint(localSyncFields(ticket), [f])
  );
  if (drifted.length) {
    throw new Error(
      `${provider.name} cannot write ${drifted.join(', ')}; local edit to ` +
        `${drifted.length > 1 ? 'those fields' : 'that field'} cannot be synced`
    );
  }

  return fresh;
}

/** Overwrite local fields + pull new comments from the remote. */
async function applyInbound(
  ticket: Ticket,
  remote: ExternalTicket,
  provider: TicketProvider,
  actor: string
): Promise<number> {
  try {
    await ticketRepo.update(
      ticket.id,
      {
        title: remote.title,
        description: remote.description,
        status: remote.status,
        priority: remote.priority,
        assignee: remote.assignee,
      },
      'system',
      {
        origin: 'remote',
        expectedSyncRevision: ticket.syncRevision,
        // Baseline commits with the fields. If notes fail afterward, retry does
        // not mistake the already-applied remote change for a fresh conflict.
        syncResult: {
          state: 'synced',
          remoteHash: fingerprint(remote),
          remoteUpdatedAt: remote.updatedAt ?? null,
          syncedAt: new Date(),
        },
      }
    );
  } catch (err) {
    if (err instanceof ticketRepo.TicketSyncRevisionConflictError) {
      await ticketRepo.markConflictAfterConcurrentLocalEdit(
        ticket.id,
        ticket.syncRevision,
        remote.updatedAt ?? null
      );
      throw new ConcurrentLocalEditDuringInbound();
    }
    throw err;
  }
  publish({ type: 'ticket.updated', ticketId: ticket.id, ticket, actor, changes: { syncState: 'synced' } });
  return pullNotes(ticket, provider);
}

/** Push local field state + any locally-authored, not-yet-synced notes outbound.
 *
 *  The field set here must match `fingerprint()`. Title and description used to
 *  be fingerprinted but not pushed, so editing either on an external ticket
 *  marked it pending, pushed nothing, and then stored a fresh baseline from the
 *  unchanged remote — permanently hiding the divergence and letting the next
 *  inbound apply overwrite the local edit. */
async function pushLocal(ticket: Ticket, remote: ExternalTicket, provider: TicketProvider): Promise<void> {
  if (provider.updateTicket) {
    const local = localSyncFields(ticket);
    const writable = provider.writableFields ?? ALL_SYNC_FIELDS;

    // Send only writable fields that actually differ from the remote. Pushing
    // the whole snapshot re-wrote fields nobody touched (clobbering unrelated
    // remote edits made between our read and write) and let an unrelated field
    // fail the whole push — an unchanged assignee whose display name is
    // ambiguous would block a simple title edit.
    const changes: SyncFields = {};
    for (const f of writable) {
      if ((local[f] ?? '').trim() !== (remote[f] ?? '').trim()) changes[f] = local[f] ?? '';
    }
    if (Object.keys(changes).length) {
      await provider.updateTicket(ticket.externalId!, changes);
    }
  }
  await pushUnsyncedNotes(ticket, provider);
}

/** The local ticket's sync-relevant fields in the shared shape. */
function localSyncFields(ticket: Ticket): SyncFields {
  return {
    status: ticket.status,
    priority: ticket.priority ?? undefined,
    assignee: ticket.assignee ?? undefined,
    title: ticket.title,
    description: ticket.description ?? undefined,
  };
}

/** Add remote comments we don't already have as local notes (dedup by externalId).
 *
 *  Failures propagate. Swallowing them let the caller mark the ticket synced and
 *  advance the provider watermark past comments that were never stored, and a
 *  ticket whose fields don't change again would never be revisited. */
async function pullNotes(ticket: Ticket, provider: TicketProvider): Promise<number> {
  if (!provider.fetchNotes) return 0;
  const remoteNotes = await provider.fetchNotes(ticket.externalId!);
  let inserted = 0;
  for (const n of remoteNotes) {
    const existing = await prisma.note.findFirst({ where: { ticketId: ticket.id, externalId: n.externalId } });
    if (existing) continue;
    await noteRepo.create(
      ticket.id,
      {
        content: n.content,
        author: n.author,
        noteType: n.noteType,
        externalId: n.externalId,
        visibility: localVisibilityForExternalNote(n),
        via: 'sync',
      },
      'system'
    );
    inserted++;
  }
  return inserted;
}

/** Push locally-authored notes (no externalId yet) out; stamp the returned id. */
async function pushUnsyncedNotes(ticket: Ticket, provider: TicketProvider): Promise<void> {
  if (!provider.pushNote) return;
  const notes = await prisma.note.findMany({
    where: { ticketId: ticket.id, externalId: null, syncPending: true },
    orderBy: { id: 'asc' },
  });
  for (const n of notes) {
    const remoteId = await provider.pushNote(ticket.externalId!, { content: n.content, author: n.author });
    if (remoteId) {
      await prisma.note.updateMany({
        where: { id: n.id, ticketId: ticket.id, externalId: null, syncPending: true },
        data: { externalId: String(remoteId), syncPending: false },
      });
    }
  }
}

/** Push a single locally-created note out immediately (best-effort, on note add). */
export async function pushNoteOut(ticketId: number, noteId: number): Promise<void> {
  const identity = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { externalProvider: true, syncConnectionId: true, mergedIntoId: true },
  });
  // Checked before the lock, not after: a merged ticket will never push, so
  // taking the account-wide lock to discover that would make note activity on
  // tombstones contend with real sync runs for no reason.
  if (identity?.mergedIntoId) return;
  const accountKey = syncAccountKeyForTicket(
    identity?.externalProvider ?? null,
    identity?.syncConnectionId ?? null
  );
  if (!accountKey) return;
  return withSyncAccountLock(accountKey, () =>
    pushNoteOutWithinAccountLock(ticketId, noteId)
  );
}

async function pushNoteOutWithinAccountLock(ticketId: number, noteId: number): Promise<void> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket?.externalId || !ticket.externalProvider) return;
  // Same tombstone rule as reconcile: a merge makes no remote change, so a note
  // landing on a merged ticket must not be the exception that does.
  if (ticket.mergedIntoId) return;
  const provider = await tryCreateTicketProviderFor(ticket.externalProvider, ticket.syncConnectionId);
  if (!provider?.canWriteBack || !provider.pushNote) return;
  const note = await prisma.note.findFirst({
    where: { id: noteId, ticketId, externalId: null, syncPending: true },
  });
  if (!note) return;
  const remoteId = await provider.pushNote(ticket.externalId, { content: note.content, author: note.author });
  if (remoteId) {
    await prisma.note.updateMany({
      where: { id: noteId, ticketId, externalId: null, syncPending: true },
      data: { externalId: String(remoteId), syncPending: false },
    });
  }
}

/** Resolve a held conflict by choosing a winning side, then syncing that way. */
export async function resolveConflict(
  ticketId: number,
  resolution: 'local' | 'remote',
  actor = 'system'
): Promise<ReconcileResult> {
  const identity = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { externalProvider: true, syncConnectionId: true },
  });
  const accountKey = syncAccountKeyForTicket(
    identity?.externalProvider ?? null,
    identity?.syncConnectionId ?? null
  );
  if (!accountKey) {
    return resolveConflictWithinAccountLock(ticketId, resolution, actor);
  }
  return withSyncAccountLock(accountKey, () =>
    resolveConflictWithinAccountLock(ticketId, resolution, actor)
  );
}

async function resolveConflictWithinAccountLock(
  ticketId: number,
  resolution: 'local' | 'remote',
  actor = 'system'
): Promise<ReconcileResult> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) return { ticketId, outcome: 'skipped', message: 'ticket not found' };
  if (ticket.syncState !== 'conflict') {
    return { ticketId, outcome: 'skipped', message: 'ticket is not in conflict' };
  }
  const provider = await tryCreateTicketProviderFor(ticket.externalProvider, ticket.syncConnectionId);
  if (!provider?.canWriteBack || !provider.getTicket) {
    return { ticketId, outcome: 'skipped', message: 'provider is not two-way capable' };
  }

  try {
    if (resolution === 'local') {
      // Read the current remote so the push sends a real delta, then verify it
      // landed — the same guarantees normal reconcile gets. This path used to
      // accept a failed re-read and record a baseline without checking
      // anything, which is precisely where silent divergence is least
      // acceptable: a human just asked for local to win.
      const current = await provider.getTicket(ticket.externalId!);
      if (!current) {
        await ticketRepo.setSyncStateIfRevision(ticketId, ticket.syncRevision, 'error');
        return { ticketId, outcome: 'error', message: 'remote ticket not found' };
      }
      const fresh = await verifiedPush(ticket, current, provider);
      const stamped = await ticketRepo.setSyncStateIfRevision(ticketId, ticket.syncRevision, 'synced', {
        remoteHash: fingerprint(fresh),
        remoteUpdatedAt: fresh.updatedAt ?? null,
        syncedAt: new Date(),
      });
      if (!stamped) {
        await ticketRepo.advanceRemoteBaselineWhilePending(ticketId, ticket.syncRevision, {
          remoteHash: fingerprint(fresh),
          remoteUpdatedAt: fresh.updatedAt ?? null,
          syncedAt: new Date(),
        });
        return {
          ticketId,
          outcome: 'conflict',
          message: 'ticket changed locally during conflict resolution; conflict remains held',
        };
      }
      publish({ type: 'ticket.updated', ticketId, ticket, actor, changes: { syncState: 'synced' } });
      return { ticketId, outcome: 'pushed' };
    }

    const remote = await provider.getTicket(ticket.externalId!);
    if (!remote) {
      await ticketRepo.setSyncStateIfRevision(ticketId, ticket.syncRevision, 'error');
      return { ticketId, outcome: 'error', message: 'remote ticket not found' };
    }
    try {
      const notesUpserted = await applyInbound(ticket, remote, provider, actor);
      return { ticketId, outcome: 'pulled', notesUpserted };
    } catch (err) {
      if (err instanceof ConcurrentLocalEditDuringInbound) {
        return {
          ticketId,
          outcome: 'conflict',
          message: 'ticket changed locally during conflict resolution; conflict remains held',
        };
      }
      throw err;
    }
  } catch (err) {
    await ticketRepo.setSyncStateIfRevision(ticketId, ticket.syncRevision, 'error');
    return { ticketId, outcome: 'error', message: (err as Error).message };
  }
}
