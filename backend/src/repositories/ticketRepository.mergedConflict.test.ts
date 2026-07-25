/**
 * A merged tombstone must never be flagged as a sync conflict.
 *
 * Merge bumps `syncRevision` on purpose, so that a reconcile already past the
 * tombstone guard fails its compare-and-set instead of writing over the ticket.
 * That failure path lands in `markConflictAfterConcurrentLocalEdit`, which sees
 * a revision higher than the one it captured — exactly the signature of a
 * concurrent local edit. Without an explicit `mergedIntoId: null` predicate the
 * losing reconcile therefore parks a deliberately-desynced ticket in the
 * conflict queue for a human to "resolve", which is the opposite of what the
 * merge decided.
 */
jest.mock('../db/prisma', () => ({
  prisma: {
    ticket: { updateMany: jest.fn() },
  },
}));

import { prisma } from '../db/prisma';
import { markConflictAfterConcurrentLocalEdit } from './ticketRepository';

const db = prisma as unknown as { ticket: { updateMany: jest.Mock } };

beforeEach(() => {
  jest.clearAllMocks();
  db.ticket.updateMany.mockResolvedValue({ count: 1 });
});

describe('markConflictAfterConcurrentLocalEdit', () => {
  it('excludes merged tickets from the conflict predicate', async () => {
    await markConflictAfterConcurrentLocalEdit(7, 3, new Date('2026-07-25T00:00:00Z'));

    expect(db.ticket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 7, mergedIntoId: null }),
      })
    );
  });

  it('still requires the revision to have advanced', async () => {
    await markConflictAfterConcurrentLocalEdit(7, 3);

    const where = db.ticket.updateMany.mock.calls[0][0].where;
    expect(where.syncRevision).toEqual({ gt: 3 });
  });

  // The tombstone matches zero rows, so the caller learns the ticket was not
  // flagged rather than being told a conflict was recorded.
  it('reports false when no row matched', async () => {
    db.ticket.updateMany.mockResolvedValue({ count: 0 });
    await expect(markConflictAfterConcurrentLocalEdit(7, 3)).resolves.toBe(false);
  });
});
