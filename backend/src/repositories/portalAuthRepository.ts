import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import type { RequesterPrincipal } from '../types/principal';
import {
  findContactsByNormalizedEmail,
  lockPortalIdentityWrites,
  normalizeContactIdentityEmail,
} from './portalIdentityRepository';

export interface MagicLinkCandidate {
  id: number;
  contactId: number;
  verifierHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface PortalSessionWrite {
  tokenHash: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
}

/**
 * Resolve an email to exactly one Contact.
 *
 * Contact.email predates portal auth and is not globally unique. Picking the
 * first match would let a shared/duplicated address choose a tenant by row
 * order, so zero and multiple matches both fail closed.
 */
export async function findUniqueRequesterByEmail(
  email: string,
): Promise<RequesterPrincipal | null> {
  const normalized = normalizeContactIdentityEmail(email);
  if (!normalized) return null;
  const matches = await findContactsByNormalizedEmail(prisma, normalized);
  if (matches.length !== 1) return null;
  return {
    kind: 'requester',
    contactId: matches[0].id,
    companyId: matches[0].companyId,
    name: matches[0].name,
    email: matches[0].email.trim(),
  };
}

export async function createMagicLink(input: {
  contactId: number;
  expectedCompanyId: number;
  expectedEmail: string;
  selectorHash: string;
  verifierHash: string;
  expiresAt: Date;
}): Promise<{ id: number } | null> {
  return prisma.$transaction(async (tx) => {
    await lockPortalIdentityWrites(tx);
    // Re-run exact-one resolution while every Contact identity write is
    // serialized. A lock on only the selected row cannot prevent a duplicate
    // email phantom from being inserted concurrently.
    const matches = await findContactsByNormalizedEmail(
      tx,
      input.expectedEmail,
    );
    const contact = matches.length === 1 ? matches[0] : null;
    if (
      !contact ||
      contact.id !== input.contactId ||
      contact.companyId !== input.expectedCompanyId
    ) {
      return null;
    }

    // Protect deletion while the credential row is inserted.
    const locked = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM contacts WHERE id = ${input.contactId} FOR SHARE
    `;
    if (locked.length !== 1) return null;

    const row = await tx.portalMagicLink.create({
      data: {
        contactId: input.contactId,
        selectorHash: input.selectorHash,
        verifierHash: input.verifierHash,
        expiresAt: input.expiresAt,
      },
    });
    await audit.record(
      {
        entityType: 'portal_magic_link',
        entityId: row.id,
        action: 'create',
        // The person typing an address has not proved they own it yet.
        changedBy: 'anonymous (portal-auth)',
        newValue: { contactId: input.contactId, expiresAt: input.expiresAt },
      },
      tx,
    );
    return { id: row.id };
  });
}

export function findMagicLinkBySelectorHash(
  selectorHash: string,
): Promise<MagicLinkCandidate | null> {
  return prisma.portalMagicLink.findUnique({
    where: { selectorHash },
    select: {
      id: true,
      contactId: true,
      verifierHash: true,
      expiresAt: true,
      usedAt: true,
    },
  });
}

/**
 * Consume a verified magic link and create its portal session in one
 * transaction. The conditional update is the replay/race boundary: exactly one
 * contender can change usedAt from null while the link is still unexpired.
 */
export async function consumeMagicLinkAndCreateSession(input: {
  linkId: number;
  contactId: number;
  now: Date;
  session: PortalSessionWrite;
  actor: string;
}): Promise<RequesterPrincipal | null> {
  return prisma.$transaction(async (tx) => {
    await lockPortalIdentityWrites(tx);
    const contact = await tx.contact.findUnique({
      where: { id: input.contactId },
      select: { id: true, companyId: true, name: true, email: true },
    });
    if (!contact?.email?.trim()) return null;
    const normalizedEmail = normalizeContactIdentityEmail(contact.email);
    if (!normalizedEmail) return null;
    const matches = await findContactsByNormalizedEmail(tx, normalizedEmail);
    if (matches.length !== 1 || matches[0].id !== contact.id) return null;

    const consumed = await tx.portalMagicLink.updateMany({
      where: {
        id: input.linkId,
        contactId: input.contactId,
        usedAt: null,
        expiresAt: { gt: input.now },
      },
      data: { usedAt: input.now },
    });
    if (consumed.count !== 1) return null;

    await tx.session.create({
      data: {
        scope: 'portal',
        userId: null,
        contactId: contact.id,
        tokenHash: input.session.tokenHash,
        userAgent: input.session.userAgent,
        ip: input.session.ip,
        expiresAt: input.session.expiresAt,
      },
    });
    await audit.record(
      {
        entityType: 'portal_magic_link',
        entityId: input.linkId,
        action: 'update',
        changedBy: input.actor,
        newValue: { usedAt: input.now, sessionScope: 'portal' },
      },
      tx,
    );

    return {
      kind: 'requester',
      contactId: contact.id,
      companyId: contact.companyId,
      name: contact.name,
      email: contact.email.trim(),
    };
  });
}

export async function pruneExpiredMagicLinks(now = new Date()): Promise<number> {
  const { count } = await prisma.portalMagicLink.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return count;
}

/**
 * Revoke exactly the presented requester session and audit the requester action
 * in the same transaction. AuditLog entity ids are numeric, so the Contact id
 * is the stable portal-session subject; no raw token or token hash is recorded.
 */
export async function revokePortalSession(input: {
  contactId: number;
  tokenHash: string;
  actor: string;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.session.deleteMany({
      where: {
        scope: 'portal',
        contactId: input.contactId,
        tokenHash: input.tokenHash,
      },
    });
    if (deleted.count !== 1) return false;
    await audit.record(
      {
        entityType: 'portal_session',
        entityId: input.contactId,
        action: 'delete',
        changedBy: input.actor,
        oldValue: { scope: 'portal', sessionsRevoked: 1 },
      },
      tx,
    );
    return true;
  });
}
