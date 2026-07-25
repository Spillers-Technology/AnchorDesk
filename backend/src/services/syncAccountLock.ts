/**
 * Cross-replica ownership for work against one external ticket account.
 *
 * Acquisition is a short PostgreSQL transaction: an advisory lock serializes
 * the check with older replicas, then a durable row becomes the mutex while
 * remote HTTP runs. We deliberately do not expire claims automatically. A lost
 * DB connection or timeout does not prove that a remote write stopped, so
 * stealing an aged claim could overlap a live worker. Process crashes therefore
 * fail closed until an operator explicitly clears the orphaned row.
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as auditRepo from '../repositories/auditRepository';

const LOCK_PREFIX = 'anchordesk-ticket-sync:';

export class SyncAccountBusyError extends Error {
  constructor(readonly accountKey: string) {
    super('another operation for this external account is already running');
    this.name = 'SyncAccountBusyError';
  }
}

export class SyncAccountClaimLostError extends Error {
  constructor(readonly accountKey: string) {
    super('sync account ownership was lost before the operation completed');
    this.name = 'SyncAccountClaimLostError';
  }
}

export class SyncAccountClaimChangedError extends Error {
  constructor() {
    super('the sync account claim changed; refresh before attempting recovery');
    this.name = 'SyncAccountClaimChangedError';
  }
}

export interface SyncAccountLockOptions {
  /** Startup recovery may close this exact stale run while still rejecting any
   * other running attempt for the account. Normal callers must omit it. */
  allowRunningRunId?: number;
}

export function syncAccountKeyForProvider(
  type: string,
  connectionId: number | null,
  providerId: number
): string {
  if (type === 'jira' && connectionId != null) {
    return `jira:connection:${connectionId}`;
  }
  if (type === 'connectwise') return 'connectwise:legacy-global';
  return `${type}:job:${providerId}`;
}

export function syncAccountKeyForTicket(
  type: string | null,
  connectionId: number | null
): string | null {
  if (!type) return null;
  if (type === 'jira') {
    return connectionId == null ? null : `jira:connection:${connectionId}`;
  }
  if (type === 'connectwise') return 'connectwise:legacy-global';
  return connectionId == null
    ? `${type}:legacy-global`
    : `${type}:connection:${connectionId}`;
}

function runningWhereForAccount(
  accountKey: string,
  allowRunningRunId?: number
): Prisma.SyncRunWhereInput {
  const jira = accountKey.match(/^jira:connection:(\d+)$/);
  const job = accountKey.match(/^[a-z0-9_-]+:job:(\d+)$/i);
  const where: Prisma.SyncRunWhereInput = {
    status: 'running',
    ...(allowRunningRunId !== undefined ? { id: { not: allowRunningRunId } } : {}),
  };

  if (jira) {
    where.provider = {
      type: 'jira',
      connectionId: Number(jira[1]),
    };
  } else if (accountKey === 'connectwise:legacy-global') {
    where.provider = { type: 'connectwise' };
  } else if (job) {
    where.providerId = Number(job[1]);
  } else {
    // No SyncRun can be reliably associated with an unknown direct-account key.
    // The durable claim still serializes every caller using that exact key.
    where.id = -1;
  }
  return where;
}

async function acquireClaim(
  accountKey: string,
  ownerToken: string,
  options: SyncAccountLockOptions
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(
        hashtext(${LOCK_PREFIX + accountKey})
      ) AS acquired
    `;
    if (lock?.acquired !== true) throw new SyncAccountBusyError(accountKey);

    const [claim, running] = await Promise.all([
      tx.syncAccountClaim.findUnique({ where: { accountKey }, select: { accountKey: true } }),
      tx.syncRun.count({
        where: runningWhereForAccount(accountKey, options.allowRunningRunId),
      }),
    ]);
    if (claim || running > 0) throw new SyncAccountBusyError(accountKey);

    await tx.syncAccountClaim.create({
      data: { accountKey, ownerToken },
    });
  });
}

async function releaseClaim(accountKey: string, ownerToken: string): Promise<void> {
  const released = await prisma.syncAccountClaim.deleteMany({
    where: { accountKey, ownerToken },
  });
  if (released.count !== 1) throw new SyncAccountClaimLostError(accountKey);
}

/** Safe claim metadata for the admin break-glass surface. Owner tokens never
 * leave the service; recovery compares the observed timestamp, then performs
 * the token CAS internally. */
export async function listSyncAccountClaims() {
  return prisma.syncAccountClaim.findMany({
    select: { accountKey: true, claimedAt: true },
    orderBy: { claimedAt: 'asc' },
  });
}

/** Explicit operator recovery for an orphaned claim. This is never automatic:
 * the caller must first stop/restart every backend worker, because deleting a
 * live owner's claim can overlap remote writes. */
export async function recoverSyncAccountClaim(
  accountKey: string,
  observedClaimedAt: Date,
  actor: string
): Promise<{ runsClosed: number }> {
  return prisma.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(
        hashtext(${LOCK_PREFIX + accountKey})
      ) AS acquired
    `;
    if (lock?.acquired !== true) throw new SyncAccountBusyError(accountKey);

    const current = await tx.syncAccountClaim.findUnique({ where: { accountKey } });
    if (!current || current.claimedAt.getTime() !== observedClaimedAt.getTime()) {
      throw new SyncAccountClaimChangedError();
    }

    const completedAt = new Date();
    const closed = await tx.syncRun.updateMany({
      where: runningWhereForAccount(accountKey),
      data: {
        status: 'error',
        completedAt,
        errorCount: { increment: 1 },
        latestError: 'An administrator recovered an orphaned external-account operation claim.',
      },
    });
    const released = await tx.syncAccountClaim.deleteMany({
      where: { accountKey, ownerToken: current.ownerToken, claimedAt: current.claimedAt },
    });
    if (released.count !== 1) throw new SyncAccountClaimChangedError();

    await auditRepo.record(
      {
        entityType: 'sync_account_claim',
        entityId: 0,
        action: 'update',
        changedBy: actor,
        oldValue: { accountKey, claimedAt: current.claimedAt.toISOString() },
        newValue: { recovered: true, runsClosed: closed.count },
      },
      tx
    );
    return { runsClosed: closed.count };
  });
}

export async function withSyncAccountLock<T>(
  accountKey: string,
  operation: () => Promise<T>,
  options: SyncAccountLockOptions = {}
): Promise<T> {
  const ownerToken = randomUUID();
  await acquireClaim(accountKey, ownerToken, options);

  let operationError: unknown;
  try {
    return await operation();
  } catch (err) {
    operationError = err;
    throw err;
  } finally {
    try {
      await releaseClaim(accountKey, ownerToken);
    } catch (releaseError) {
      if (operationError === undefined) throw releaseError;
      // Preserve both failures: the original operation did not succeed, and the
      // durable claim may now require operator recovery.
      throw new AggregateError(
        [operationError, releaseError],
        'sync operation failed and its account claim could not be released'
      );
    }
  }
}
