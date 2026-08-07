import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { revokeContactPortalCredentials } from './portalIdentityRepository';

export interface PortalGrantRow {
  id: number;
  contactId: number;
  companyId: number;
  grantedBy: string;
  grantedAt: Date;
  effectiveFrom: Date;
  revokedBy: string | null;
  revokedAt: Date | null;
}

/** Every grant ever issued for a contact, newest first — the legible history
 * a boolean could never give ("who let this person in, when, is it still live"). */
export function listForContact(contactId: number): Promise<PortalGrantRow[]> {
  return prisma.portalGrant.findMany({
    where: { contactId },
    orderBy: { grantedAt: 'desc' },
  });
}

export function findActive(contactId: number): Promise<PortalGrantRow | null> {
  return prisma.portalGrant.findFirst({
    where: { contactId, revokedAt: null },
    orderBy: { grantedAt: 'desc' },
  });
}

/** Grant access as a new record, never by flipping a flag on an old one.
 * `effectiveFrom` defaults to the grant instant — company-scope reads only
 * reach tickets from this point on unless the contact was personally the
 * requester (see portalRepository.requesterTicketWhere). A technician can
 * widen it explicitly ("give access to past tickets"), which is itself part
 * of the audited record rather than an unexplained wider default. */
export async function grant(
  input: { contactId: number; companyId: number; effectiveFrom?: Date },
  actorSub: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<PortalGrantRow> {
  const grantedAt = new Date();
  const row = await db.portalGrant.create({
    data: {
      contactId: input.contactId,
      companyId: input.companyId,
      grantedBy: actorSub,
      grantedAt,
      effectiveFrom: input.effectiveFrom ?? grantedAt,
    },
  });
  await audit.record({
    entityType: 'portal_grant',
    entityId: row.id,
    action: 'create',
    changedBy: actorSub,
    newValue: { contactId: row.contactId, companyId: row.companyId, effectiveFrom: row.effectiveFrom },
  }, db);
  return row;
}

/** Revoked, not deleted — the row stays as the record of what happened.
 * Returns null if there is no active grant to revoke (idempotent no-op from
 * the caller's perspective; the route 404s or treats as already-revoked).
 * "Revocation means revoked" (portal v2 design): a live session or an
 * unredeemed magic link must not outlive the grant they depend on, so both
 * are torn down in the same transaction as the revocation itself, reusing
 * the exact credential sweep the ambiguous-identity path already trusts. */
export async function revoke(contactId: number, actorSub: string): Promise<PortalGrantRow | null> {
  const active = await findActive(contactId);
  if (!active) return null;
  const revokedAt = new Date();
  return prisma.$transaction(async (tx) => {
    const row = await tx.portalGrant.update({
      where: { id: active.id },
      data: { revokedBy: actorSub, revokedAt },
    });
    await revokeContactPortalCredentials(tx, [contactId]);
    await audit.record({
      entityType: 'portal_grant',
      entityId: row.id,
      action: 'update',
      changedBy: actorSub,
      oldValue: { revokedAt: null },
      newValue: { revokedAt },
    }, tx);
    return row;
  });
}
