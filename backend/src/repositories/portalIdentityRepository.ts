import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';

// V1 deliberately serializes the small CRM identity-write surface globally.
// This prevents a duplicate-email phantom between exact-one lookup and link
// issuance without adding a unique constraint that legacy CRM data cannot meet.
const PORTAL_IDENTITY_ADVISORY_LOCK = 2_700_003;

type IdentityDb = Prisma.TransactionClient | typeof prisma;

export interface ContactIdentityRow {
  id: number;
  companyId: number;
  name: string;
  email: string;
}

export function normalizeContactIdentityEmail(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

export function canonicalContactEmail(
  value: unknown,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw Object.assign(new Error('email must be a string or null'), {
      statusCode: 400,
    });
  }
  return normalizeContactIdentityEmail(value);
}

export async function lockPortalIdentityWrites(
  tx: Prisma.TransactionClient,
): Promise<void> {
  // pg_advisory_xact_lock() returns PostgreSQL's `void` type, which Prisma
  // cannot deserialize. Put the volatile function in FROM so it still executes,
  // while the result set contains only an ordinary integer sentinel.
  const rows = await tx.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
    SELECT 1::int AS locked
    FROM pg_advisory_xact_lock(${PORTAL_IDENTITY_ADVISORY_LOCK})
  `);
  if (rows.length !== 1 || rows[0].locked !== 1) {
    throw new Error('Failed to acquire portal identity lock');
  }
}

/**
 * Match the canonical identity in SQL so legacy outer whitespace cannot evade
 * duplicate detection. Two rows are enough because every non-singleton result
 * fails closed.
 */
export function findContactsByNormalizedEmail(
  db: IdentityDb,
  normalizedEmail: string,
): Promise<ContactIdentityRow[]> {
  return db.$queryRaw<ContactIdentityRow[]>(Prisma.sql`
    SELECT id,
           company_id AS "companyId",
           name,
           email
    FROM contacts
    WHERE email IS NOT NULL
      AND lower(btrim(email)) = ${normalizedEmail}
    ORDER BY id ASC
    LIMIT 2
  `);
}

/** Delete the bearer rows first so an in-flight redemption must finish before
 * the following session sweep; a newly-created ambiguous identity cannot leave
 * a just-redeemed session alive. */
export async function revokeContactPortalCredentials(
  tx: Prisma.TransactionClient,
  contactIds: number[],
): Promise<void> {
  if (contactIds.length === 0) return;
  await tx.portalMagicLink.deleteMany({
    where: { contactId: { in: contactIds } },
  });
  await tx.session.deleteMany({
    where: { contactId: { in: contactIds }, scope: 'portal' },
  });
}

export async function revokeIfEmailAmbiguous(
  tx: Prisma.TransactionClient,
  normalizedEmail: string | null,
): Promise<void> {
  if (!normalizedEmail) return;
  const matches = await findContactsByNormalizedEmail(tx, normalizedEmail);
  if (matches.length > 1) {
    await revokeContactPortalCredentials(
      tx,
      matches.map((contact) => contact.id),
    );
  }
}
