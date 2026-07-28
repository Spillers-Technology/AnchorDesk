jest.mock('../db/prisma', () => ({
  prisma: {
    portalGrant: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));
jest.mock('./auditRepository', () => ({
  record: jest.fn(),
}));

import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { findActive, grant, listForContact, revoke } from './portalGrantRepository';

const db = prisma as unknown as {
  portalGrant: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};
const recordAudit = audit.record as jest.Mock;

describe('portalGrantRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists every grant for a contact, newest first', async () => {
    db.portalGrant.findMany.mockResolvedValue([{ id: 2 }, { id: 1 }]);
    await expect(listForContact(7)).resolves.toEqual([{ id: 2 }, { id: 1 }]);
    expect(db.portalGrant.findMany).toHaveBeenCalledWith({
      where: { contactId: 7 },
      orderBy: { grantedAt: 'desc' },
    });
  });

  it('finds only a live (unrevoked) grant', async () => {
    db.portalGrant.findFirst.mockResolvedValue({ id: 3 });
    await expect(findActive(7)).resolves.toEqual({ id: 3 });
    expect(db.portalGrant.findFirst).toHaveBeenCalledWith({
      where: { contactId: 7, revokedAt: null },
      orderBy: { grantedAt: 'desc' },
    });
  });

  it('grants access as a new record and defaults effectiveFrom to the grant instant', async () => {
    const created = {
      id: 5,
      contactId: 7,
      companyId: 3,
      grantedBy: 'alice',
      grantedAt: new Date('2026-07-27T00:00:00.000Z'),
      effectiveFrom: new Date('2026-07-27T00:00:00.000Z'),
      revokedBy: null,
      revokedAt: null,
    };
    db.portalGrant.create.mockResolvedValue(created);

    const row = await grant({ contactId: 7, companyId: 3 }, 'alice');

    expect(row).toEqual(created);
    const data = db.portalGrant.create.mock.calls[0][0].data;
    expect(data.contactId).toBe(7);
    expect(data.companyId).toBe(3);
    expect(data.grantedBy).toBe('alice');
    expect(data.effectiveFrom).toEqual(data.grantedAt);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'portal_grant',
        entityId: 5,
        action: 'create',
        changedBy: 'alice',
      }),
    );
  });

  it('honors an explicit effectiveFrom (widen to full history)', async () => {
    db.portalGrant.create.mockResolvedValue({ id: 6 });
    const past = new Date('2020-01-01T00:00:00.000Z');
    await grant({ contactId: 7, companyId: 3, effectiveFrom: past }, 'alice');
    expect(db.portalGrant.create.mock.calls[0][0].data.effectiveFrom).toEqual(past);
  });

  it('revokes the active grant rather than deleting it', async () => {
    db.portalGrant.findFirst.mockResolvedValue({ id: 5, contactId: 7, revokedAt: null });
    db.portalGrant.update.mockResolvedValue({ id: 5, revokedBy: 'bob', revokedAt: new Date() });

    const row = await revoke(7, 'bob');

    expect(row?.revokedBy).toBe('bob');
    expect(db.portalGrant.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ revokedBy: 'bob' }),
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'portal_grant', entityId: 5, action: 'update' }),
    );
  });

  it('is a no-op when there is nothing active to revoke', async () => {
    db.portalGrant.findFirst.mockResolvedValue(null);
    await expect(revoke(7, 'bob')).resolves.toBeNull();
    expect(db.portalGrant.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
