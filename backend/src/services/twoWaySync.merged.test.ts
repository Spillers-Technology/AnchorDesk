/**
 * The load-bearing guarantee of the 2.6 merge feature: a merged ticket is a
 * tombstone that STOPS syncing.
 *
 * Without this, the next sync run applies the (still open) remote state over the
 * ticket the operator just merged away — reopening it, undoing the merge's
 * status change, and leaving the conversation split across two tickets. That is
 * the failure the whole "merge never pushes, merged tickets stop reconciling"
 * rule exists to prevent, so it is tested directly rather than inferred.
 */

jest.mock('../db/prisma', () => ({
  prisma: {
    ticket: { findUnique: jest.fn() },
    note: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  },
}));

jest.mock('../providers/ticketProviderFactory', () => ({
  tryCreateTicketProviderFor: jest.fn(),
}));

jest.mock('../repositories/ticketRepository', () => ({
  setSyncStateIfRevision: jest.fn(),
  advanceRemoteBaselineWhilePending: jest.fn(),
  markConflictAfterConcurrentLocalEdit: jest.fn(),
  TicketSyncRevisionConflictError: class extends Error {},
}));

jest.mock('../repositories/noteRepository', () => ({ create: jest.fn() }));
jest.mock('./realtime/eventBus', () => ({ publish: jest.fn() }));

import { prisma } from '../db/prisma';
import { tryCreateTicketProviderFor } from '../providers/ticketProviderFactory';
import * as ticketRepo from '../repositories/ticketRepository';
import { pushNoteOut, reconcileTicketWithinAccountLock } from './twoWaySync';

const db = prisma as unknown as {
  ticket: { findUnique: jest.Mock };
  note: { findFirst: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };
};
const factory = tryCreateTicketProviderFor as jest.Mock;

const provider = {
  name: 'jira',
  canWriteBack: true,
  getTicket: jest.fn(),
  updateTicket: jest.fn(),
  pushNote: jest.fn(),
  fetchNotes: jest.fn(),
  writableFields: ['status', 'priority', 'assignee', 'title', 'description'],
};

const mergedTicket = {
  id: 1,
  externalId: 'HELP-1',
  externalProvider: 'jira',
  syncConnectionId: 3,
  syncState: 'synced',
  syncRevision: 4,
  remoteHash: 'abc',
  mergedIntoId: 42,
  status: 'Closed',
  title: 'Printer down',
  priority: 'Medium',
  assignee: null,
  description: null,
  syncedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  factory.mockResolvedValue(provider);
});

describe('reconcile of a merged ticket', () => {
  it('reports `merged` and performs no remote I/O at all', async () => {
    db.ticket.findUnique.mockResolvedValue(mergedTicket);

    const result = await reconcileTicketWithinAccountLock(1, { actor: 'alice' });

    expect(result.outcome).toBe('merged');
    expect(result.message).toContain('#42');
    // Not a single call out to the provider, in either direction.
    expect(provider.getTicket).not.toHaveBeenCalled();
    expect(provider.updateTicket).not.toHaveBeenCalled();
    expect(provider.pushNote).not.toHaveBeenCalled();
    expect(provider.fetchNotes).not.toHaveBeenCalled();
    // And no local sync bookkeeping was rewritten either.
    expect(ticketRepo.setSyncStateIfRevision).not.toHaveBeenCalled();
  });

  // `merged` is deliberately distinct from `skipped`: skipping degrades a run's
  // health, and a merged tombstone left alone is the design working. Collapsing
  // them would leave every run permanently "degraded".
  it('is not reported as `skipped`', async () => {
    db.ticket.findUnique.mockResolvedValue(mergedTicket);
    const result = await reconcileTicketWithinAccountLock(1, { actor: 'alice' });
    expect(result.outcome).not.toBe('skipped');
  });

  it('takes precedence over a queued outbound note', async () => {
    db.ticket.findUnique.mockResolvedValue(mergedTicket);
    db.note.findFirst.mockResolvedValue({ id: 77 });

    const result = await reconcileTicketWithinAccountLock(1, { actor: 'alice' });

    expect(result.outcome).toBe('merged');
    expect(provider.pushNote).not.toHaveBeenCalled();
  });

  it('still reconciles normally once the ticket is unmerged', async () => {
    db.ticket.findUnique.mockResolvedValue({ ...mergedTicket, mergedIntoId: null, syncState: 'synced' });
    db.note.findFirst.mockResolvedValue(null);
    db.note.findMany.mockResolvedValue([]);
    provider.getTicket.mockResolvedValue({
      externalId: 'HELP-1',
      title: 'Printer down',
      status: 'Closed',
      priority: 'Medium',
      updatedAt: new Date(),
    });
    provider.fetchNotes.mockResolvedValue([]);
    (ticketRepo.setSyncStateIfRevision as jest.Mock).mockResolvedValue(true);

    const result = await reconcileTicketWithinAccountLock(1, { actor: 'alice' });

    expect(provider.getTicket).toHaveBeenCalledWith('HELP-1');
    expect(result.outcome).not.toBe('merged');
  });
});

describe('pushNoteOut on a merged ticket', () => {
  it('does not push the note to the tombstone’s remote', async () => {
    db.ticket.findUnique.mockResolvedValue(mergedTicket);

    await pushNoteOut(1, 77);

    expect(provider.pushNote).not.toHaveBeenCalled();
  });
});
