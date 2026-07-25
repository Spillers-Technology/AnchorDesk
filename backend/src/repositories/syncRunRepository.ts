/**
 * Durable run-level health for ticket sync.
 *
 * SyncProvider.lastSyncedAt is an incremental-fetch watermark, not evidence
 * that the latest attempt succeeded. SyncRun records every manual/scheduled
 * attempt, including zero-result successes and failures before the fetch, so
 * the admin UI can report health without inferring run boundaries from
 * record-level SyncLog rows.
 */

import { Prisma, SyncRun, SyncRunStatus, SyncRunTrigger } from '@prisma/client';
import { prisma } from '../db/prisma';
import {
  SyncAccountBusyError,
  syncAccountKeyForProvider,
  withSyncAccountLock,
} from '../services/syncAccountLock';

export interface SyncRunCounts {
  ticketsCreated: number;
  ticketsUpdated: number;
  notesUpserted: number;
  ticketsFiltered: number;
  ticketsSkipped: number;
  ticketsConflicted: number;
  errorCount: number;
  errors: string[];
  durationMs: number;
}

export type SyncHealthStatus = 'never_run' | 'running' | 'healthy' | 'degraded' | 'failing';

export interface SyncRunHealth {
  status: SyncHealthStatus;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
  latestError: string | null;
  latestRun: ReturnType<typeof toPublicSummary> | null;
}

const MAX_ERROR_LENGTH = 2000;
/** Without a cross-replica lease, a freshly-starting pod cannot prove that a
 * running row belongs to a dead process instead of another live pod. Only rows
 * far beyond any expected provider timeout are recovered automatically. */
const INTERRUPTED_RUN_GRACE_MS = 4 * 60 * 60_000;

export class SyncRunStartConflictError extends Error {}

/**
 * Last line of defense before a remote error reaches durable storage or an API
 * response. Provider clients already redact their response bodies; this also
 * covers unexpected errors raised outside those clients.
 */
export function sanitizeSyncError(value: string): string {
  return value
    .replace(/(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, '$1 [redacted]')
    .replace(
      /("?(?:authorization|apiToken|api_token|password|privateKey|clientId|token)"?\s*[:=]\s*)"?[^",}\s]+"?/gi,
      '$1[redacted]'
    )
    .replace(/AT[AC]TT[A-Za-z0-9+/=_-]{10,}/g, '[redacted]')
    .slice(0, MAX_ERROR_LENGTH);
}

export async function start(
  providerId: number,
  configRevision: number,
  trigger: SyncRunTrigger,
  initiatedBy: string | null | undefined,
  lockedAccountKey: string
) {
  return prisma.$transaction(async (tx) => {
    // Lock and compare the job revision before recording the attempt. Every
    // replica serializes starts/deletes on this row; the durable running record
    // then acts as the database mutex after this short transaction commits.
    // This avoids holding a database connection across remote HTTP work.
    const current = await tx.$queryRaw<
      Array<{
        config_revision: number;
        type: string;
        connection_id: number | null;
      }>
    >`
      SELECT config_revision, type, connection_id
      FROM sync_providers
      WHERE id = ${providerId}
        AND config_revision = ${configRevision}
        AND enabled = true
      FOR UPDATE
    `;
    if (current.length !== 1) {
      throw new SyncRunStartConflictError(
        'sync job was disabled or its scope changed before the run started; reload it and try again'
      );
    }

    const expectedAccountKey = syncAccountKeyForProvider(
      current[0].type,
      current[0].connection_id,
      providerId
    );
    if (lockedAccountKey !== expectedAccountKey) {
      throw new SyncRunStartConflictError(
        'sync job account changed before the run started; reload it and try again'
      );
    }

    const runningWhere: Prisma.SyncRunWhereInput =
      current[0].type === 'jira' && current[0].connection_id != null
        ? {
            status: 'running',
            provider: {
              type: 'jira',
              connectionId: current[0].connection_id,
            },
          }
        : current[0].type === 'connectwise'
          ? {
              status: 'running',
              provider: { type: 'connectwise' },
            }
          : { providerId, status: 'running' };

    // Keep the durable running row as an independent fail-closed guard. Losing
    // the advisory-lock connection does not prove the JavaScript worker stopped
    // making remote requests, so a new start must not auto-close this row.
    // Startup recovery handles only protocol-1 rows beyond the conservative
    // stale grace and only after it can acquire the same account lock.
    const running = await tx.syncRun.count({
      where: runningWhere,
    });
    if (running > 0) {
      throw new SyncRunStartConflictError(
        'another sync job for this external account is already running'
      );
    }
    return tx.syncRun.create({
      data: {
        providerId,
        configRevision,
        lockProtocol: 1,
        trigger,
        initiatedBy: initiatedBy?.slice(0, 255) || null,
        status: 'running',
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function finish(
  id: number,
  status: Exclude<SyncRunStatus, 'running'>,
  result: SyncRunCounts
) {
  const updated = await prisma.syncRun.updateMany({
    where: { id, status: 'running' },
    data: {
      status,
      completedAt: new Date(),
      durationMs: Math.max(0, Math.round(result.durationMs)),
      ticketsCreated: result.ticketsCreated,
      ticketsUpdated: result.ticketsUpdated,
      notesUpserted: result.notesUpserted,
      ticketsFiltered: result.ticketsFiltered,
      ticketsSkipped: result.ticketsSkipped,
      ticketsConflicted: result.ticketsConflicted,
      errorCount: result.errorCount,
      latestError:
        result.errors.length > 0
          ? sanitizeSyncError(result.errors[result.errors.length - 1])
          : null,
    },
  });
  if (updated.count === 1) {
    return prisma.syncRun.findUniqueOrThrow({ where: { id } });
  }

  // Terminalization is idempotent: a retry after a lost response returns the
  // already-completed row instead of overwriting its original outcome.
  const existing = await prisma.syncRun.findUnique({ where: { id } });
  if (!existing) throw new Error(`sync run ${id} no longer exists`);
  if (existing.status === 'running') {
    throw new Error(`sync run ${id} could not be finalized`);
  }
  return existing;
}

/**
 * Close rows that have remained running far beyond the recovery grace instead
 * of showing "Running" forever after a crash. Fresh rows are left alone because
 * another pod may still own them during a rolling deployment.
 */
export async function recoverInterruptedRuns(): Promise<number> {
  const staleBefore = new Date(Date.now() - INTERRUPTED_RUN_GRACE_MS);
  const interrupted = await prisma.syncRun.findMany({
    where: {
      status: 'running',
      lockProtocol: 1,
      startedAt: { lt: staleBefore },
    },
    select: {
      id: true,
      providerId: true,
      startedAt: true,
      provider: { select: { type: true, connectionId: true } },
    },
  });
  if (interrupted.length === 0) return 0;

  let recovered = 0;
  for (const run of interrupted) {
    const accountKey = syncAccountKeyForProvider(
      run.provider.type,
      run.provider.connectionId,
      run.providerId
    );
    try {
      recovered += await withSyncAccountLock(
        accountKey,
        async () => {
          const completedAt = new Date();
          const result = await prisma.syncRun.updateMany({
            // Compare-and-set: if a run completed between the read and acquiring
            // the account claim, never overwrite its real outcome.
            where: { id: run.id, status: 'running' },
            data: {
              status: 'error',
              completedAt,
              durationMs: Math.max(0, completedAt.getTime() - run.startedAt.getTime()),
              errorCount: 1,
              latestError: 'AnchorDesk restarted before this sync run completed.',
            },
          });
          return result.count;
        },
        { allowRunningRunId: run.id }
      );
    } catch (err) {
      // A live worker still owns the account; a rolling pod must not declare
      // its run dead merely because the row is old.
      if (err instanceof SyncAccountBusyError) continue;
      throw err;
    }
  }
  return recovered;
}

export function toPublicSummary(run: SyncRun) {
  return {
    id: run.id,
    providerId: run.providerId,
    configRevision: run.configRevision,
    trigger: run.trigger,
    status: run.status,
    initiatedBy: run.initiatedBy,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    ticketsCreated: run.ticketsCreated,
    ticketsUpdated: run.ticketsUpdated,
    notesUpserted: run.notesUpserted,
    ticketsFiltered: run.ticketsFiltered,
    ticketsSkipped: run.ticketsSkipped,
    ticketsConflicted: run.ticketsConflicted,
    errorCount: run.errorCount,
    latestError: run.latestError ? sanitizeSyncError(run.latestError) : null,
  };
}

function healthStatus(run: SyncRun | null): SyncHealthStatus {
  if (!run) return 'never_run';
  switch (run.status) {
    case 'running':
      return 'running';
    case 'success':
      return 'healthy';
    case 'degraded':
      return 'degraded';
    case 'error':
      return 'failing';
  }
}

async function healthForProvider(
  providerId: number,
  configRevision: number
): Promise<SyncRunHealth> {
  const currentRevision = { providerId, configRevision };
  const [latest, lastSuccess, lastNonError] = await Promise.all([
    prisma.syncRun.findFirst({
      where: currentRevision,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    }),
    prisma.syncRun.findFirst({
      where: { ...currentRevision, status: 'success' },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    }),
    prisma.syncRun.findFirst({
      where: { ...currentRevision, status: { in: ['success', 'degraded'] } },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    }),
  ]);

  let consecutiveFailures = 0;
  if (latest?.status === 'error' || latest?.status === 'running') {
    consecutiveFailures = await prisma.syncRun.count({
      where: {
        ...currentRevision,
        status: 'error',
        ...(lastNonError
          ? {
              OR: [
                { startedAt: { gt: lastNonError.startedAt } },
                { startedAt: lastNonError.startedAt, id: { gt: lastNonError.id } },
              ],
            }
          : {}),
      },
    });
  }

  const previousIssue =
    latest?.status === 'running'
      ? await prisma.syncRun.findFirst({
          where: {
            ...currentRevision,
            status: { in: ['error', 'degraded'] },
            id: { not: latest.id },
          },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        })
      : null;

  return {
    status: healthStatus(latest),
    lastAttemptAt: latest?.startedAt ?? null,
    lastSuccessAt: lastSuccess?.completedAt ?? lastSuccess?.startedAt ?? null,
    consecutiveFailures,
    latestError:
      latest?.status === 'running'
        ? previousIssue?.latestError ?? null
        : latest && (latest.status === 'error' || latest.status === 'degraded')
          ? latest.latestError
          : null,
    latestRun: latest ? toPublicSummary(latest) : null,
  };
}

export async function healthForProviders(
  providers: Array<{ id: number; configRevision: number }>
): Promise<Map<number, SyncRunHealth>> {
  const pairs = await Promise.all(
    providers.map(
      async ({ id, configRevision }) =>
        [id, await healthForProvider(id, configRevision)] as const
    )
  );
  return new Map(pairs);
}

export async function list(opts: { providerName?: string; limit?: number } = {}) {
  return prisma.syncRun.findMany({
    where: opts.providerName ? { provider: { name: opts.providerName } } : undefined,
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
    include: { provider: { select: { name: true, type: true } } },
  });
}

export async function getWithLogs(id: number) {
  return prisma.syncRun.findUnique({
    where: { id },
    include: {
      provider: { select: { name: true, type: true } },
      // Bound the detail payload; a broad first import can produce thousands of
      // record rows. The run-level counters remain complete.
      syncLogs: { orderBy: { syncedAt: 'desc' }, take: 500 },
      _count: { select: { syncLogs: true } },
    },
  });
}
