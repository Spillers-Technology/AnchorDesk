jest.mock('../db/prisma', () => ({
  prisma: {
    portalRegistration: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('./auditRepository', () => ({ record: jest.fn() }));
jest.mock('./portalGrantRepository', () => ({ grant: jest.fn() }));
jest.mock('./portalIdentityRepository', () => ({
  findContactsByNormalizedEmail: jest.fn(),
  lockPortalIdentityWrites: jest.fn(),
  normalizeContactIdentityEmail: (email: string) => email.trim().toLowerCase(),
}));

import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import * as grants from './portalGrantRepository';
import * as identity from './portalIdentityRepository';
import {
  approve,
  create,
  list,
  PortalRegistrationApprovalError,
  reject,
} from './portalRegistrationRepository';

const db = prisma as unknown as {
  portalRegistration: { create: jest.Mock; findMany: jest.Mock };
  $transaction: jest.Mock;
};
const tx = {
  portalRegistration: { findUnique: jest.fn(), update: jest.fn() },
  contact: { create: jest.fn() },
};

describe('portalRegistrationRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.$transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) => callback(tx));
  });

  it('creates an auditable pending registration without exposing match state', async () => {
    const row = { id: 3, email: 'rita@example.com', companyId: 4, status: 'pending', company: null, contact: null };
    db.portalRegistration.create.mockResolvedValue(row);

    await expect(create({ email: 'rita@example.com', companyId: 4 }, 'portal-registration')).resolves.toEqual(row);
    expect(db.portalRegistration.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { email: 'rita@example.com', companyId: 4, status: 'pending' },
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'portal_registration', entityId: 3, action: 'create', changedBy: 'portal-registration',
    }));
  });

  it('lists newest first with an optional status filter', async () => {
    db.portalRegistration.findMany.mockResolvedValue([{ id: 2 }]);
    await expect(list('pending')).resolves.toEqual([{ id: 2 }]);
    expect(db.portalRegistration.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'pending' }, orderBy: { createdAt: 'desc' },
    }));
  });

  it('approves atomically, creates the missing contact, audits each record, and grants access', async () => {
    tx.portalRegistration.findUnique.mockResolvedValue({ id: 7, email: 'Rita@example.com', companyId: 4, status: 'pending', contactId: null });
    (identity.findContactsByNormalizedEmail as jest.Mock).mockResolvedValue([]);
    tx.contact.create.mockResolvedValue({ id: 12, companyId: 4, name: 'rita@example.com', email: 'rita@example.com' });
    const approved = { id: 7, email: 'rita@example.com', status: 'approved', contactId: 12, company: null, contact: null };
    tx.portalRegistration.update.mockResolvedValue(approved);

    await expect(approve(7, 'alice')).resolves.toEqual(approved);
    expect(tx.contact.create).toHaveBeenCalledWith({ data: { companyId: 4, name: 'rita@example.com', email: 'rita@example.com' } });
    expect(grants.grant).toHaveBeenCalledWith({ contactId: 12, companyId: 4 }, 'alice', tx);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'contact', entityId: 12 }), tx);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'portal_registration', entityId: 7, action: 'update' }), tx);
  });

  it('reuses an exact-one legacy contact instead of creating a duplicate', async () => {
    tx.portalRegistration.findUnique.mockResolvedValue({ id: 7, email: 'rita@example.com', companyId: 4, status: 'pending', contactId: null });
    (identity.findContactsByNormalizedEmail as jest.Mock).mockResolvedValue([{ id: 12, companyId: 9, name: 'Rita', email: 'rita@example.com' }]);
    tx.portalRegistration.update.mockResolvedValue({ id: 7, status: 'approved', contactId: 12, company: null, contact: null });

    await approve(7, 'alice');
    expect(tx.contact.create).not.toHaveBeenCalled();
    expect(grants.grant).toHaveBeenCalledWith({ contactId: 12, companyId: 9 }, 'alice', tx);
  });

  it('fails closed when an approval has no company match or an ambiguous contact identity', async () => {
    tx.portalRegistration.findUnique.mockResolvedValue({ id: 7, email: 'rita@example.com', companyId: null, status: 'pending', contactId: null });
    (identity.findContactsByNormalizedEmail as jest.Mock).mockResolvedValue([]);
    await expect(approve(7, 'alice')).rejects.toBeInstanceOf(PortalRegistrationApprovalError);

    tx.portalRegistration.findUnique.mockResolvedValue({ id: 7, email: 'rita@example.com', companyId: 4, status: 'pending', contactId: null });
    (identity.findContactsByNormalizedEmail as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }]);
    await expect(approve(7, 'alice')).rejects.toBeInstanceOf(PortalRegistrationApprovalError);
    expect(grants.grant).not.toHaveBeenCalled();
  });

  it('rejects a pending request with an audited review record', async () => {
    tx.portalRegistration.findUnique.mockResolvedValue({ id: 7, status: 'pending' });
    tx.portalRegistration.update.mockResolvedValue({ id: 7, status: 'rejected', company: null, contact: null });
    await expect(reject(7, 'alice')).resolves.toMatchObject({ status: 'rejected' });
    expect(tx.portalRegistration.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7 }, data: expect.objectContaining({ status: 'rejected', reviewedBy: 'alice' }),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'portal_registration', action: 'update' }), tx);
  });
});
