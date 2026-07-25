jest.mock('../../db/prisma', () => ({
  prisma: {
    ticket: { findUnique: jest.fn(), count: jest.fn() },
    note: { count: jest.fn() },
    attachment: { count: jest.fn() },
    checklistItem: { count: jest.fn() },
    ticketLabel: { findMany: jest.fn() },
    deviceLink: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../realtime/eventBus', () => ({ publish: jest.fn() }));
jest.mock('../../repositories/auditRepository', () => ({ record: jest.fn() }));

import { prisma } from '../../db/prisma';
import {
  MergeAcknowledgementRequiredError,
  MergeBlockedError,
  mergeTickets,
  previewMerge,
  resolveMergeTarget,
  unmergeTicket,
} from './mergeService';
import { MERGE_LEDGER_VERSION } from './mergeLedger';

const db = prisma as unknown as {
  ticket: { findUnique: jest.Mock; count: jest.Mock };
  note: { count: jest.Mock };
  attachment: { count: jest.Mock };
  checklistItem: { count: jest.Mock };
  ticketLabel: { findMany: jest.Mock };
  deviceLink: { findMany: jest.Mock };
  $transaction: jest.Mock;
};

function ticket(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    ticketNumber: '10001',
    title: 'Printer down',
    status: 'New',
    companyId: 1,
    companyName: 'Contoso',
    externalId: null,
    externalProvider: null,
    syncState: null,
    mergedIntoId: null,
    parentId: null,
    closedAt: null,
    ...over,
  };
}

/** Wire the count/findMany calls previewMerge makes after its blocker checks. */
function stubCounts() {
  db.note.count.mockResolvedValue(0);
  db.attachment.count.mockResolvedValue(0);
  db.checklistItem.count.mockResolvedValue(0);
  db.ticket.count.mockResolvedValue(0);
  db.ticketLabel.findMany.mockResolvedValue([]);
  db.deviceLink.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  stubCounts();
});

describe('resolveMergeTarget', () => {
  it('returns the ticket itself when it is not merged', async () => {
    db.ticket.findUnique.mockResolvedValue({ mergedIntoId: null });
    expect(await resolveMergeTarget(5)).toBe(5);
  });

  // Merge chains are walked rather than path-compressed, so a reply to the
  // oldest thread in a chain still has to reach the ticket that is alive.
  it('walks a chain of merges to the survivor', async () => {
    db.ticket.findUnique
      .mockResolvedValueOnce({ mergedIntoId: 2 })
      .mockResolvedValueOnce({ mergedIntoId: 3 })
      .mockResolvedValueOnce({ mergedIntoId: null });
    expect(await resolveMergeTarget(1)).toBe(3);
  });

  // This runs on the inbound-mail hot path, where looping forever would wedge
  // the poller on one poison message.
  it('stops on a cycle instead of looping', async () => {
    db.ticket.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve({ mergedIntoId: where.id === 1 ? 2 : 1 })
    );
    await expect(resolveMergeTarget(1)).resolves.toBe(2);
  });
});

describe('previewMerge blockers', () => {
  it('blocks merging a ticket into itself', async () => {
    db.ticket.findUnique.mockResolvedValue(ticket({ id: 4 }));
    const preview = await previewMerge(4, 4);
    expect(preview.blockers.map((b) => b.code)).toContain('same-ticket');
  });

  it('blocks a source that is already merged', async () => {
    db.ticket.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(
        where.id === 1 ? ticket({ id: 1, mergedIntoId: 9 }) : ticket({ id: 2, parentId: null })
      )
    );
    const preview = await previewMerge(1, 2);
    expect(preview.blockers.map((b) => b.code)).toContain('already-merged');
  });

  // A merge must not become a back door for burying a conflict the operator was
  // asked to resolve.
  it('blocks a source held in sync conflict', async () => {
    db.ticket.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(
        where.id === 1
          ? ticket({ id: 1, syncState: 'conflict', externalId: 'HELP-1', externalProvider: 'jira' })
          : ticket({ id: 2 })
      )
    );
    const preview = await previewMerge(1, 2);
    expect(preview.blockers.map((b) => b.code)).toContain('sync-conflict');
  });

  // Reparenting the source's children onto a target that is itself a child would
  // build a depth-2 tree, which the pgExtras trigger rejects. Without this
  // blocker the operator gets a raw constraint violation out of the middle of
  // the merge transaction instead of a sentence explaining the problem.
  it('blocks merging a ticket with children into a ticket that is itself a child', async () => {
    db.ticket.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(
        where.id === 2
          ? ticket({ id: 2, ticketNumber: '10002', parentId: 7 })
          : ticket({ id: where.id, parentId: null })
      )
    );
    db.ticket.count.mockResolvedValue(2); // the source is a parent

    const preview = await previewMerge(1, 2);
    const blocker = preview.blockers.find((b) => b.code === 'target-would-nest');
    expect(blocker).toBeDefined();
    expect(blocker!.message).toContain('one level of hierarchy');
  });

  it('allows merging a ticket with children into a top-level target', async () => {
    db.ticket.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(ticket({ id: where.id, parentId: null }))
    );
    db.ticket.count.mockResolvedValue(2);

    const preview = await previewMerge(1, 2);
    expect(preview.blockers).toEqual([]);
    expect(preview.moves.children).toBe(2);
  });
});

describe('previewMerge warnings', () => {
  it('warns that a synced source stops syncing, naming the remote issue', async () => {
    db.ticket.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(
        where.id === 1
          ? ticket({ id: 1, externalId: 'HELP-1', externalProvider: 'jira' })
          : ticket({ id: 2 })
      )
    );
    const preview = await previewMerge(1, 2);
    const warning = preview.warnings.find((w) => w.code === 'sync-stop');
    expect(warning).toBeDefined();
    expect(warning!.message).toContain('HELP-1');
    expect(warning!.message).toContain('stop syncing');
    // The remote is explicitly NOT touched — the sentence has to say so, because
    // that is the whole reason the acknowledgement exists.
    expect(warning!.message).toMatch(/not closed, commented on, or linked/);
  });

  it('warns when the two tickets belong to different companies', async () => {
    db.ticket.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(
        where.id === 1
          ? ticket({ id: 1, companyId: 1, companyName: 'Contoso' })
          : ticket({ id: 2, companyId: 2, companyName: 'Fabrikam' })
      )
    );
    const preview = await previewMerge(1, 2);
    expect(preview.warnings.map((w) => w.code)).toContain('cross-company');
  });

  it('raises no warnings for two plain local tickets in one company', async () => {
    db.ticket.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(ticket({ id: where.id }))
    );
    const preview = await previewMerge(1, 2);
    expect(preview.warnings).toEqual([]);
    expect(preview.blockers).toEqual([]);
  });
});

describe('mergeTickets consent gate', () => {
  it('refuses to merge until every warning is acknowledged', async () => {
    db.ticket.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(
        where.id === 1
          ? ticket({ id: 1, externalId: 'HELP-1', externalProvider: 'jira' })
          : ticket({ id: 2 })
      )
    );
    await expect(mergeTickets(1, 2, 'alice')).rejects.toBeInstanceOf(
      MergeAcknowledgementRequiredError
    );
    // And it must not have opened a transaction on the way out.
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('names exactly which acknowledgements are outstanding', async () => {
    db.ticket.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(
        where.id === 1
          ? ticket({ id: 1, externalId: 'HELP-1', externalProvider: 'jira', companyId: 1 })
          : ticket({ id: 2, companyId: 2, companyName: 'Fabrikam' })
      )
    );
    // Acknowledge only one of the two.
    await expect(
      mergeTickets(1, 2, 'alice', { acknowledge: ['sync-stop'] })
    ).rejects.toMatchObject({ requiresAcknowledgement: ['cross-company'] });
  });

  it('refuses a blocked merge regardless of what was acknowledged', async () => {
    db.ticket.findUnique.mockResolvedValue(ticket({ id: 4 }));
    await expect(
      mergeTickets(4, 4, 'alice', { acknowledge: ['sync-stop', 'cross-company'] })
    ).rejects.toBeInstanceOf(MergeBlockedError);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  // Preview runs outside the transaction, so the hierarchy could change under
  // it. Merging into a child would reparent the target onto itself.
  it('re-checks the descendant rule inside the locked transaction', async () => {
    db.ticket.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      // Clean at preview time: target has no parent yet.
      Promise.resolve(ticket({ id: where.id, parentId: null }))
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      ticket: {
        // Inside the transaction the target has become a child of the source.
        findUniqueOrThrow: jest.fn(({ where }: { where: { id: number } }) =>
          Promise.resolve(
            where.id === 2 ? ticket({ id: 2, parentId: 1 }) : ticket({ id: 1 })
          )
        ),
      },
    };
    db.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));

    await expect(mergeTickets(1, 2, 'alice')).rejects.toMatchObject({
      blockers: [expect.objectContaining({ code: 'target-descendant' })],
    });
  });

  // Same reasoning for the one-level rule: preview saw a childless source and a
  // top-level target, then both changed before the lock was taken.
  it('re-checks the one-level rule inside the locked transaction', async () => {
    db.ticket.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(ticket({ id: where.id, parentId: null }))
    );
    db.ticket.count.mockResolvedValue(0); // clean at preview time

    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      ticket: {
        findUniqueOrThrow: jest.fn(({ where }: { where: { id: number } }) =>
          Promise.resolve(where.id === 2 ? ticket({ id: 2, parentId: 7 }) : ticket({ id: 1 }))
        ),
        // A child was attached to the source after preview ran.
        findMany: jest.fn().mockResolvedValue([{ id: 55 }]),
      },
      note: { findMany: jest.fn().mockResolvedValue([]) },
      attachment: { findMany: jest.fn().mockResolvedValue([]) },
      checklistItem: { findMany: jest.fn().mockResolvedValue([]) },
      ticketLabel: { findMany: jest.fn().mockResolvedValue([]) },
      deviceLink: { findMany: jest.fn().mockResolvedValue([]) },
    };
    db.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));

    await expect(mergeTickets(1, 2, 'alice')).rejects.toMatchObject({
      blockers: [expect.objectContaining({ code: 'target-would-nest' })],
    });
  });
});

describe('unmergeTicket restore', () => {
  function unmergeTx(over: Record<string, unknown> = {}) {
    return {
      // Unmerge locks the tombstone before reading it, so two concurrent
      // unmerges cannot both act on the same ledger.
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      ticket: {
        findUnique: jest.fn().mockResolvedValue(
          ticket({ id: 1, mergedIntoId: 2, externalId: null, externalProvider: null })
        ),
        update: jest.fn().mockResolvedValue(ticket({ id: 1, mergedIntoId: null })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      ticketMerge: {
        findFirst: jest.fn().mockResolvedValue({
          id: 10,
          sourceId: 1,
          targetId: 2,
          undoPlan: {
            version: MERGE_LEDGER_VERSION,
            noteIds: [100, 101],
            attachmentIds: [],
            checklistItems: [],
            childIds: [],
            addedLabelIds: [],
            addedDeviceIds: [],
            sourceLabelIds: [],
            sourceDeviceIds: [],
            clearedSyncPendingNoteIds: [],
            source: { status: 'New', closedAt: null, syncState: null, parentId: null },
          },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      note: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      attachment: { updateMany: jest.fn() },
      checklistItem: { updateMany: jest.fn() },
      ticketLabel: { deleteMany: jest.fn(), createMany: jest.fn() },
      deviceLink: { deleteMany: jest.fn(), createMany: jest.fn() },
      ...over,
    };
  }

  // With A merged into B and then B into C, undoing B→C must move the notes back
  // to B while a note that originally came from A still names A. Blanking every
  // moved note's origin would erase that older provenance.
  it('clears provenance only on notes this merge itself moved off the source', async () => {
    const tx = unmergeTx();
    db.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));

    await unmergeTicket(1, 'alice');

    const calls = tx.note.updateMany.mock.calls.map((c) => c[0]);
    // First: everything named in the ledger comes back to the source — but only
    // the rows still sitting on the target this merge moved them to.
    expect(calls[0]).toMatchObject({
      where: { id: { in: [100, 101] }, ticketId: 2 },
      data: { ticketId: 1 },
    });
    // Second: origin is cleared ONLY where this merge set it (originTicketId = source).
    expect(calls[1]).toMatchObject({
      where: { id: { in: [100, 101] }, originTicketId: 1 },
      data: { originTicketId: null },
    });
  });

  // A ledger that describes a different merge than the one the ticket is
  // actually in means the rows are not where we would be pulling them from.
  it('refuses when the ledger names a different target than the tombstone does', async () => {
    const tx = unmergeTx({
      ticketMerge: {
        findFirst: jest.fn().mockResolvedValue({ id: 10, sourceId: 1, targetId: 77, undoPlan: {} }),
        update: jest.fn(),
      },
    });
    db.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));

    await expect(unmergeTicket(1, 'alice')).rejects.toBeInstanceOf(MergeBlockedError);
    expect(tx.note.updateMany).not.toHaveBeenCalled();
  });

  // v1 restored only the labels the merge ADDED to the target, while the merge
  // deleted every source association — so a label both tickets carried was lost.
  it('gives the source back every label it had, not just the ones added to the target', async () => {
    const tx = unmergeTx({
      ticketMerge: {
        findFirst: jest.fn().mockResolvedValue({
          id: 10,
          sourceId: 1,
          targetId: 2,
          undoPlan: {
            version: MERGE_LEDGER_VERSION,
            noteIds: [],
            attachmentIds: [],
            checklistItems: [],
            childIds: [],
            // The target already had label 8; only 3 was newly added to it.
            addedLabelIds: [3],
            addedDeviceIds: [],
            sourceLabelIds: [3, 8],
            sourceDeviceIds: [],
            clearedSyncPendingNoteIds: [],
            source: { status: 'New', closedAt: null, syncState: null, parentId: null },
          },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    db.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));

    await unmergeTicket(1, 'alice');

    // Only the merge's own addition is stripped from the target...
    expect(tx.ticketLabel.deleteMany).toHaveBeenCalledWith({
      where: { ticketId: 2, labelId: { in: [3] } },
    });
    // ...but the source gets both of its labels back.
    expect(tx.ticketLabel.createMany).toHaveBeenCalledWith({
      data: [
        { ticketId: 1, labelId: 3 },
        { ticketId: 1, labelId: 8 },
      ],
      skipDuplicates: true,
    });
  });

  it('refuses to restore when the merge has no undo record', async () => {
    const tx = unmergeTx({ ticketMerge: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } });
    db.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));

    await expect(unmergeTicket(1, 'alice')).rejects.toBeInstanceOf(MergeBlockedError);
    expect(tx.note.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a ticket that is not merged', async () => {
    const tx = unmergeTx({
      ticket: {
        findUnique: jest.fn().mockResolvedValue(ticket({ id: 1, mergedIntoId: null })),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });
    db.$transaction.mockImplementation((fn: (t: unknown) => unknown) => fn(tx));

    await expect(unmergeTicket(1, 'alice')).rejects.toBeInstanceOf(MergeBlockedError);
  });
});
