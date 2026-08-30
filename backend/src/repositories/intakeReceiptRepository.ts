/**
 * Idempotency ledger for `intake`-scoped API tokens (see `IntakeCreateReceipt`
 * in schema.prisma and the collision-nondisclosure notes in
 * routes/tickets.ts). This is the entire security property: an intake
 * credential's "identity key" is a caller-chosen opaque `idempotencyKey`
 * scoped to *that token only*, never a business identity (phone number,
 * email, externalId) that could coincidentally already belong to an
 * unrelated ticket. A collision can therefore only ever replay the same
 * credential's own prior response.
 *
 * Concurrency-safe by construction: `claim()` atomically inserts a row with
 * `ticketId`/`responseBody` still null via the (apiTokenId, idempotencyKey)
 * unique constraint. Only the caller that wins the insert may create the
 * ticket; every other caller (whether it's a true retry after completion, or
 * a race arriving before completion) is told to replay or wait — never to
 * read a *different* ticket than the one this exact key represents.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { hasPrismaCode } from '../util/prismaErrors';

/**
 * A claim older than this is considered abandoned. Reclaim is safe because
 * ticket creation and receipt completion are committed in the same database
 * transaction (see ticketRepository.create's `intakeReceiptId` option): an
 * incomplete receipt therefore cannot have a committed ticket behind it.
 */
export const STALE_CLAIM_MS = 5 * 60 * 1000;

export type ClaimResult =
  | { outcome: 'claimed'; receiptId: number }
  | { outcome: 'replay'; responseBody: unknown }
  | { outcome: 'in-progress' };

/**
 * Attempt to claim (apiTokenId, idempotencyKey) for a new create. Returns:
 *  - `claimed`     — caller owns this key; proceed to create the ticket, then
 *                    complete it atomically inside ticketRepository.create.
 *  - `replay`      — this key already completed; return the frozen
 *                    `responseBody` (do not re-read the ticket — it may have
 *                    drifted since, which would disclose more than the
 *                    original response did).
 *  - `in-progress` — another request for this exact key is still being
 *                    processed (a genuine concurrent retry by the same
 *                    credential). The caller should return 409 and let the
 *                    client retry; this never touches another party's data.
 */
export async function claim(apiTokenId: number, idempotencyKey: string): Promise<ClaimResult> {
  try {
    const row = await prisma.intakeCreateReceipt.create({
      data: { apiTokenId, idempotencyKey },
    });
    return { outcome: 'claimed', receiptId: row.id };
  } catch (error) {
    if (!hasPrismaCode(error, 'P2002')) throw error;
    const existing = await prisma.intakeCreateReceipt.findUnique({
      where: { apiTokenId_idempotencyKey: { apiTokenId, idempotencyKey } },
    });
    // Deleted between our failed insert and this read (fail() cleanup) —
    // safe to treat as available; the caller may retry claim().
    if (!existing) return { outcome: 'in-progress' };
    if (existing.responseBody !== null) return { outcome: 'replay', responseBody: existing.responseBody };

    // A hard process exit can leave the pre-create claim behind. Reclaim only
    // an old, still-incomplete row, using a conditional delete so a concurrent
    // completion or another reclaimer wins safely. If this request wins the
    // delete, retry the normal unique-insert claim path from the top.
    if (existing.createdAt.getTime() <= Date.now() - STALE_CLAIM_MS) {
      const reclaimed = await prisma.intakeCreateReceipt.deleteMany({
        where: {
          id: existing.id,
          responseBody: { equals: Prisma.DbNull },
          createdAt: { lte: new Date(Date.now() - STALE_CLAIM_MS) },
        },
      });
      if (reclaimed.count === 1) return claim(apiTokenId, idempotencyKey);

      // A concurrent completion/reclaim changed the row after our read. Re-run
      // the lookup path so the caller gets replay/in-progress from fresh state.
      return claim(apiTokenId, idempotencyKey);
    }
    return { outcome: 'in-progress' };
  }
}

/** Release a claim that failed before completion, so the same key can be retried cleanly. */
export async function fail(receiptId: number): Promise<void> {
  // Never erase a completed receipt. ticketRepository publishes realtime
  // events after its transaction commits; if that best-effort publication
  // unexpectedly throws, the route's error path must retain the committed
  // idempotency result instead of making a retry create a duplicate ticket.
  await prisma.intakeCreateReceipt.deleteMany({
    where: { id: receiptId, responseBody: { equals: Prisma.DbNull } },
  }).catch(() => {});
}
