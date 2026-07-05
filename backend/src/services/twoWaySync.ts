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
import { ExternalTicket, TicketProvider } from '../providers/TicketProvider';
import { tryCreateTicketProvider } from '../providers/ticketProviderFactory';
import * as ticketRepo from '../repositories/ticketRepository';
import * as noteRepo from '../repositories/noteRepository';
import { publish } from './realtime/eventBus';

export type ReconcileOutcome = 'synced' | 'pushed' | 'pulled' | 'conflict' | 'error' | 'skipped';

export interface ReconcileResult {
  ticketId: number;
  outcome: ReconcileOutcome;
  message?: string;
}

/** Fingerprint the writeback-relevant remote fields; order-stable, whitespace-normalized. */
export function fingerprint(t: {
  status?: string;
  priority?: string;
  assignee?: string;
  title?: string;
  description?: string;
}): string {
  const norm = [t.status, t.priority, t.assignee, t.title, t.description]
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
  const actor = opts.actor ?? 'system';
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) return { ticketId, outcome: 'skipped', message: 'ticket not found' };
  if (!ticket.externalId || !ticket.externalProvider) {
    return { ticketId, outcome: 'skipped', message: 'not an external ticket' };
  }

  const provider = tryCreateTicketProvider(ticket.externalProvider);
  if (!provider || !provider.canWriteBack || !provider.getTicket) {
    return { ticketId, outcome: 'skipped', message: 'provider is not two-way capable' };
  }

  let remote: ExternalTicket | null;
  try {
    remote = opts.remote ?? (await provider.getTicket(ticket.externalId));
  } catch (err) {
    await ticketRepo.setSyncState(ticketId, 'error');
    return { ticketId, outcome: 'error', message: (err as Error).message };
  }
  if (!remote) {
    await ticketRepo.setSyncState(ticketId, 'error');
    return { ticketId, outcome: 'error', message: 'remote ticket not found' };
  }

  const remoteHash = fingerprint(remote);
  // First reconcile (no baseline) never counts as a remote change, so a fresh
  // ingest can't be mistaken for a conflict.
  const remoteChanged = ticket.remoteHash != null && ticket.remoteHash !== remoteHash;
  const localPending = ticket.syncState === 'pending';

  try {
    if (remoteChanged && localPending) {
      await ticketRepo.setSyncState(ticketId, 'conflict', { remoteUpdatedAt: remote.updatedAt ?? null });
      publish({ type: 'ticket.updated', ticketId, ticket, actor, changes: { syncState: 'conflict' } });
      return { ticketId, outcome: 'conflict' };
    }

    if (remoteChanged) {
      await applyInbound(ticket, remote, provider, actor);
      return { ticketId, outcome: 'pulled' };
    }

    if (localPending) {
      await pushLocal(ticket, provider);
      const fresh = (await provider.getTicket(ticket.externalId)) ?? remote;
      await ticketRepo.setSyncState(ticketId, 'synced', {
        remoteHash: fingerprint(fresh),
        remoteUpdatedAt: fresh.updatedAt ?? null,
        syncedAt: new Date(),
      });
      publish({ type: 'ticket.updated', ticketId, ticket, actor, changes: { syncState: 'synced' } });
      return { ticketId, outcome: 'pushed' };
    }

    // Nothing changed — make sure a baseline hash + synced state are recorded.
    await ticketRepo.setSyncState(ticketId, 'synced', {
      remoteHash,
      remoteUpdatedAt: remote.updatedAt ?? null,
      syncedAt: ticket.syncedAt ?? new Date(),
    });
    return { ticketId, outcome: 'synced' };
  } catch (err) {
    await ticketRepo.setSyncState(ticketId, 'error');
    return { ticketId, outcome: 'error', message: (err as Error).message };
  }
}

/** Overwrite local fields + pull new comments from the remote. */
async function applyInbound(
  ticket: Ticket,
  remote: ExternalTicket,
  provider: TicketProvider,
  actor: string
): Promise<void> {
  await ticketRepo.update(
    ticket.id,
    {
      title: remote.title,
      summary: remote.summary,
      description: remote.description,
      status: remote.status,
      priority: remote.priority,
      assignee: remote.assignee,
    },
    'system'
  );
  await pullNotes(ticket, provider);
  await ticketRepo.setSyncState(ticket.id, 'synced', {
    remoteHash: fingerprint(remote),
    remoteUpdatedAt: remote.updatedAt ?? null,
    syncedAt: new Date(),
  });
  publish({ type: 'ticket.updated', ticketId: ticket.id, ticket, actor, changes: { syncState: 'synced' } });
}

/** Push local field state + any locally-authored, not-yet-synced notes outbound. */
async function pushLocal(ticket: Ticket, provider: TicketProvider): Promise<void> {
  if (provider.updateTicket) {
    await provider.updateTicket(ticket.externalId!, {
      status: ticket.status,
      priority: ticket.priority ?? undefined,
      assignee: ticket.assignee ?? undefined,
    });
  }
  await pushUnsyncedNotes(ticket, provider);
}

/** Add remote comments we don't already have as local notes (dedup by externalId). */
async function pullNotes(ticket: Ticket, provider: TicketProvider): Promise<void> {
  if (!provider.fetchNotes) return;
  const remoteNotes = await provider.fetchNotes(ticket.externalId!).catch(() => []);
  for (const n of remoteNotes) {
    const existing = await prisma.note.findFirst({ where: { ticketId: ticket.id, externalId: n.externalId } });
    if (existing) continue;
    await noteRepo
      .create(
        ticket.id,
        { content: n.content, author: n.author, noteType: n.noteType, externalId: n.externalId },
        'system'
      )
      .catch(() => undefined);
  }
}

/** Push locally-authored notes (no externalId yet) out; stamp the returned id. */
async function pushUnsyncedNotes(ticket: Ticket, provider: TicketProvider): Promise<void> {
  if (!provider.pushNote) return;
  const notes = await prisma.note.findMany({
    where: { ticketId: ticket.id, externalId: null, noteType: { in: ['note', 'email', 'internal'] } },
    orderBy: { id: 'asc' },
  });
  for (const n of notes) {
    const remoteId = await provider.pushNote(ticket.externalId!, { content: n.content, author: n.author });
    if (remoteId) await prisma.note.update({ where: { id: n.id }, data: { externalId: String(remoteId) } });
  }
}

/** Push a single locally-created note out immediately (best-effort, on note add). */
export async function pushNoteOut(ticketId: number, noteId: number): Promise<void> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket?.externalId || !ticket.externalProvider) return;
  const provider = tryCreateTicketProvider(ticket.externalProvider);
  if (!provider?.canWriteBack || !provider.pushNote) return;
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note || note.externalId) return; // already synced or gone
  const remoteId = await provider.pushNote(ticket.externalId, { content: note.content, author: note.author });
  if (remoteId) await prisma.note.update({ where: { id: noteId }, data: { externalId: String(remoteId) } });
}

/** Resolve a held conflict by choosing a winning side, then syncing that way. */
export async function resolveConflict(
  ticketId: number,
  resolution: 'local' | 'remote',
  actor = 'system'
): Promise<ReconcileResult> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) return { ticketId, outcome: 'skipped', message: 'ticket not found' };
  if (ticket.syncState !== 'conflict') {
    return { ticketId, outcome: 'skipped', message: 'ticket is not in conflict' };
  }
  const provider = tryCreateTicketProvider(ticket.externalProvider);
  if (!provider?.canWriteBack || !provider.getTicket) {
    return { ticketId, outcome: 'skipped', message: 'provider is not two-way capable' };
  }

  try {
    if (resolution === 'local') {
      await pushLocal(ticket, provider);
      const fresh = (await provider.getTicket(ticket.externalId!)) ?? null;
      await ticketRepo.setSyncState(ticketId, 'synced', {
        remoteHash: fresh ? fingerprint(fresh) : undefined,
        remoteUpdatedAt: fresh?.updatedAt ?? null,
        syncedAt: new Date(),
      });
      publish({ type: 'ticket.updated', ticketId, ticket, actor, changes: { syncState: 'synced' } });
      return { ticketId, outcome: 'pushed' };
    }

    const remote = await provider.getTicket(ticket.externalId!);
    if (!remote) {
      await ticketRepo.setSyncState(ticketId, 'error');
      return { ticketId, outcome: 'error', message: 'remote ticket not found' };
    }
    await applyInbound(ticket, remote, provider, actor);
    return { ticketId, outcome: 'pulled' };
  } catch (err) {
    await ticketRepo.setSyncState(ticketId, 'error');
    return { ticketId, outcome: 'error', message: (err as Error).message };
  }
}
