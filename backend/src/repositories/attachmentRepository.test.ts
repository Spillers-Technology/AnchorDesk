jest.mock('../db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
  },
}));

jest.mock('./auditRepository', () => ({
  record: jest.fn(),
}));

import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { attachToNote } from './attachmentRepository';

const tx = {
  note: {
    findUnique: jest.fn(),
  },
  attachment: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
};

const transaction = prisma.$transaction as jest.Mock;
const auditRecord = audit.record as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  transaction.mockImplementation(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
});

describe('attachment note linking', () => {
  it('scopes the audience change to the note ticket and audits it atomically', async () => {
    tx.note.findUnique.mockResolvedValue({ ticketId: 42 });
    tx.attachment.findMany.mockResolvedValue([
      { id: 9, noteId: null, portalVisible: false },
    ]);
    tx.attachment.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      attachToNote([9, 99], 5, true, 'technician (api)'),
    ).resolves.toEqual({ count: 1 });

    expect(tx.attachment.findMany).toHaveBeenCalledWith({
      where: { id: { in: [9, 99] }, ticketId: 42 },
      select: { id: true, noteId: true, portalVisible: true },
    });
    expect(tx.attachment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [9] }, ticketId: 42 },
      data: { noteId: 5, portalVisible: true },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      {
        entityType: 'attachment',
        entityId: 9,
        action: 'update',
        changedBy: 'technician (api)',
        oldValue: { noteId: null, portalVisible: false },
        newValue: { noteId: 5, portalVisible: true },
      },
      tx,
    );
  });

  it('fails before changing anything when the target note does not exist', async () => {
    tx.note.findUnique.mockResolvedValue(null);

    await expect(
      attachToNote([9], 5, true, 'imap'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.attachment.updateMany).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });
});
