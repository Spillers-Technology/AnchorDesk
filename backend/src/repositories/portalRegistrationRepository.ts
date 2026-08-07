import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import * as portalGrants from './portalGrantRepository';
import {
  findContactsByNormalizedEmail,
  lockPortalIdentityWrites,
  normalizeContactIdentityEmail,
} from './portalIdentityRepository';
import { normalizeRegistrationStatus } from '../services/portalVocab';

export interface PortalRegistrationRow {
  id: number;
  email: string;
  companyId: number | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  contactId: number | null;
  createdAt: Date;
  company: { id: number; name: string; domain: string | null } | null;
  contact: { id: number; name: string; email: string | null; companyId: number } | null;
}

const registrationInclude = {
  company: { select: { id: true, name: true, domain: true } },
  contact: { select: { id: true, name: true, email: true, companyId: true } },
} satisfies Prisma.PortalRegistrationInclude;

export class PortalRegistrationApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortalRegistrationApprovalError';
  }
}

/** Persist every request. The public route deliberately returns one neutral
 * response whether or not this request could be matched to a company. */
export async function create(
  input: { email: string; companyId: number | null },
  actorSub: string,
): Promise<PortalRegistrationRow> {
  const row = await prisma.portalRegistration.create({
    data: { email: input.email, companyId: input.companyId, status: 'pending' },
    include: registrationInclude,
  });
  await audit.record({
    entityType: 'portal_registration',
    entityId: row.id,
    action: 'create',
    changedBy: actorSub,
    newValue: { email: row.email, companyId: row.companyId, status: row.status },
  });
  return row;
}

export function list(status?: string): Promise<PortalRegistrationRow[]> {
  return prisma.portalRegistration.findMany({
    where: status ? { status } : undefined,
    include: registrationInclude,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Approve once, atomically. A unique existing Contact wins; otherwise a new
 * Contact is added only to the Company that the registration matched. A
 * duplicate legacy identity fails closed rather than minting a third Contact
 * whose magic link could never be redeemed.
 */
export async function approve(
  id: number,
  actorSub: string,
): Promise<PortalRegistrationRow | null> {
  return prisma.$transaction(async (tx) => {
    await lockPortalIdentityWrites(tx);
    const current = await tx.portalRegistration.findUnique({ where: { id } });
    if (!current) return null;
    if (current.status !== 'pending') {
      throw new PortalRegistrationApprovalError('registration has already been reviewed');
    }

    const email = normalizeContactIdentityEmail(current.email);
    if (!email) throw new PortalRegistrationApprovalError('registration email is invalid');
    const matches = await findContactsByNormalizedEmail(tx, email);
    if (matches.length > 1) {
      throw new PortalRegistrationApprovalError('registration email matches multiple contacts');
    }

    let contactId: number;
    let companyId: number;
    if (matches.length === 1) {
      contactId = matches[0].id;
      companyId = matches[0].companyId;
    } else {
      if (current.companyId === null) {
        throw new PortalRegistrationApprovalError('registration has no matched company');
      }
      const contact = await tx.contact.create({
        data: {
          companyId: current.companyId,
          // Registration deliberately asks only for an email. Keep the
          // automatically-created CRM display name honest and editable.
          name: email,
          email,
        },
      });
      contactId = contact.id;
      companyId = contact.companyId;
      await audit.record({
        entityType: 'contact',
        entityId: contact.id,
        action: 'create',
        changedBy: actorSub,
        newValue: { name: contact.name, companyId: contact.companyId, email: contact.email },
      }, tx);
    }

    const reviewedAt = new Date();
    const row = await tx.portalRegistration.update({
      where: { id },
      data: { status: 'approved', reviewedBy: actorSub, reviewedAt, contactId },
      include: registrationInclude,
    });
    await audit.record({
      entityType: 'portal_registration',
      entityId: row.id,
      action: 'update',
      changedBy: actorSub,
      oldValue: { status: current.status, contactId: current.contactId },
      newValue: { status: row.status, contactId: row.contactId, reviewedAt },
    }, tx);
    await portalGrants.grant({ contactId, companyId }, actorSub, tx);
    return row;
  });
}

export async function reject(
  id: number,
  actorSub: string,
): Promise<PortalRegistrationRow | null> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.portalRegistration.findUnique({ where: { id } });
    if (!current) return null;
    if (current.status !== 'pending') {
      throw new PortalRegistrationApprovalError('registration has already been reviewed');
    }
    const reviewedAt = new Date();
    const row = await tx.portalRegistration.update({
      where: { id },
      data: { status: 'rejected', reviewedBy: actorSub, reviewedAt },
      include: registrationInclude,
    });
    await audit.record({
      entityType: 'portal_registration',
      entityId: row.id,
      action: 'update',
      changedBy: actorSub,
      oldValue: { status: current.status },
      newValue: { status: row.status, reviewedAt },
    }, tx);
    return row;
  });
}

export function validatedRegistrationStatus(value: unknown): string | null {
  return typeof value === 'string' ? normalizeRegistrationStatus(value) : null;
}
