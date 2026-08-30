jest.mock('../db/prisma', () => ({
  prisma: {
    intakeCreateReceipt: {
      create: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

import { prisma } from '../db/prisma';
import * as receipts from './intakeReceiptRepository';

const db = prisma as unknown as {
  intakeCreateReceipt: Record<'create' | 'findUnique' | 'deleteMany', jest.Mock>;
};

describe('intakeReceiptRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('claims a previously unseen per-token key', async () => {
    db.intakeCreateReceipt.create.mockResolvedValue({ id: 17 });

    await expect(receipts.claim(5, 'call-17')).resolves.toEqual({
      outcome: 'claimed',
      receiptId: 17,
    });
    expect(db.intakeCreateReceipt.create).toHaveBeenCalledWith({
      data: { apiTokenId: 5, idempotencyKey: 'call-17' },
    });
  });

  it('replays only the frozen response belonging to that token and key', async () => {
    db.intakeCreateReceipt.create.mockRejectedValue({ code: 'P2002' });
    db.intakeCreateReceipt.findUnique.mockResolvedValue({
      id: 17,
      createdAt: new Date(),
      responseBody: { id: 91, title: 'Original' },
    });

    await expect(receipts.claim(5, 'call-17')).resolves.toEqual({
      outcome: 'replay',
      responseBody: { id: 91, title: 'Original' },
    });
  });

  it('reports a recent incomplete claim as in progress', async () => {
    db.intakeCreateReceipt.create.mockRejectedValue({ code: 'P2002' });
    db.intakeCreateReceipt.findUnique.mockResolvedValue({
      id: 17,
      createdAt: new Date(),
      responseBody: null,
    });

    await expect(receipts.claim(5, 'call-17')).resolves.toEqual({ outcome: 'in-progress' });
    expect(db.intakeCreateReceipt.deleteMany).not.toHaveBeenCalled();
  });

  it('atomically reclaims an abandoned incomplete claim', async () => {
    db.intakeCreateReceipt.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce({ id: 18 });
    db.intakeCreateReceipt.findUnique.mockResolvedValue({
      id: 17,
      createdAt: new Date(Date.now() - receipts.STALE_CLAIM_MS - 1_000),
      responseBody: null,
    });
    db.intakeCreateReceipt.deleteMany.mockResolvedValue({ count: 1 });

    await expect(receipts.claim(5, 'call-17')).resolves.toEqual({
      outcome: 'claimed',
      receiptId: 18,
    });
    expect(db.intakeCreateReceipt.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 17 }),
    });
    expect(db.intakeCreateReceipt.create).toHaveBeenCalledTimes(2);
  });

  it('failure cleanup cannot erase an already-completed receipt', async () => {
    db.intakeCreateReceipt.deleteMany.mockResolvedValue({ count: 0 });

    await receipts.fail(17);

    expect(db.intakeCreateReceipt.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 17 }),
    });
  });
});
