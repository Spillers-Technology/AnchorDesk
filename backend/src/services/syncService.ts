/**
 * Sync service — ingests tickets from a TicketProvider into the local database.
 *
 * Designed to be called on-demand (via API) or on a schedule.
 * All sync activity is recorded in sync_log for observability.
 *
 * GoF pattern: Factory — createProvider() instantiates the correct
 * TicketProvider implementation based on the sync_providers.type column.
 */

import { SyncRunStatus, SyncRunTrigger, TicketSource } from '@prisma/client';
import { prisma } from '../db/prisma';
import {
  localVisibilityForExternalNote,
  TicketProvider,
} from '../providers/TicketProvider';
import { createTicketProvider, resolveCredentials } from '../providers/ticketProviderFactory';
import * as ticketRepo from '../repositories/ticketRepository';
import * as noteRepo from '../repositories/noteRepository';
import * as twoWaySync from './twoWaySync';
import { matches, parseSyncFilter } from './syncFilter';
import * as syncRunRepo from '../repositories/syncRunRepository';
import {
  syncAccountKeyForProvider,
  withSyncAccountLock,
} from './syncAccountLock';

/** How far back the incremental window is rewound on each run, to cover remote
 *  search-index lag and clock skew. Duplicates are idempotent; gaps are not. */
const WATERMARK_OVERLAP_MS = 5 * 60_000;
/** Exact counts remain on the run; only a bounded tail of actionable issue
 * samples is returned to callers and retained for the latest-error summary. */
const MAX_ISSUE_SAMPLES = 20;
const activeProviderIds = new Set<number>();

export interface SyncResult {
  /** Null only when durable run recording itself could not start. */
  runId: number | null;
  providerId: number;
  providerName: string;
  status: Exclude<SyncRunStatus, 'running'>;
  ticketsCreated: number;
  ticketsUpdated: number;
  notesUpserted: number;
  /** Fetched from the remote but rejected by this provider's sync filter. */
  ticketsFiltered: number;
  ticketsSkipped: number;
  ticketsConflicted: number;
  errorCount: number;
  errors: string[];
  durationMs: number;
}

export interface SyncRunContext {
  trigger: SyncRunTrigger;
  actor?: string | null;
}

type ProviderRow = {
  id: number;
  name: string;
  type: string;
  config: unknown;
  lastSyncedAt: Date | null;
  configRevision: number;
  connectionId?: number | null;
};

export class SyncAlreadyRunningError extends Error {
  constructor(readonly providerId: number) {
    super(`sync job ${providerId} is already running`);
  }
}

export class SyncRunFinalizationError extends Error {
  constructor(
    readonly runId: number,
    cause: unknown
  ) {
    super(`sync run ${runId} could not be finalized: ${(cause as Error).message}`);
  }
}

export function isSyncActive(providerId: number): boolean {
  return activeProviderIds.has(providerId);
}

function addIssue(result: SyncResult, message: string): void {
  if (result.errors.length === MAX_ISSUE_SAMPLES) result.errors.shift();
  result.errors.push(syncRunRepo.sanitizeSyncError(message));
}

function emptyResult(providerRow: Pick<ProviderRow, 'id' | 'name'>): SyncResult {
  return {
    runId: null,
    providerId: providerRow.id,
    providerName: providerRow.name,
    status: 'success',
    ticketsCreated: 0,
    ticketsUpdated: 0,
    notesUpserted: 0,
    ticketsFiltered: 0,
    ticketsSkipped: 0,
    ticketsConflicted: 0,
    errorCount: 0,
    errors: [],
    durationMs: 0,
  };
}

/**
 * Run one job through the same durable recorder whether it was started by an
 * admin or the scheduler. The wrapper deliberately owns every exit path:
 * config errors, remote failures, zero-result success, and unexpected throws
 * all finish the SyncRun row before a result is returned.
 */
export async function runSync(providerRow: ProviderRow, context: SyncRunContext): Promise<SyncResult> {
  if (activeProviderIds.has(providerRow.id)) {
    throw new SyncAlreadyRunningError(providerRow.id);
  }
  activeProviderIds.add(providerRow.id);
  try {
    const accountKey = syncAccountKeyForProvider(
      providerRow.type,
      providerRow.connectionId ?? null,
      providerRow.id
    );
    return await withSyncAccountLock(accountKey, async () => {
      const started = Date.now();
      const run = await syncRunRepo.start(
        providerRow.id,
        providerRow.configRevision,
        context.trigger,
        context.actor,
        accountKey
      );
      let result: SyncResult;

      try {
        result = await executeSync(providerRow, run.id);
      } catch (err) {
        result = emptyResult(providerRow);
        result.status = 'error';
        result.errorCount = 1;
        addIssue(result, `Sync run failed: ${(err as Error).message}`);
      }

      result.runId = run.id;
      result.durationMs = Date.now() - started;
      if (result.status === 'success' && result.errors.length > 0) result.status = 'degraded';

      // A lost database response must be retryable without changing an already
      // terminal outcome. `finish` is compare-and-set/idempotent for this reason.
      try {
        await syncRunRepo.finish(run.id, result.status, result);
      } catch (firstError) {
        try {
          await syncRunRepo.finish(run.id, result.status, result);
        } catch {
          throw new SyncRunFinalizationError(run.id, firstError);
        }
      }
      return result;
    });
  } finally {
    activeProviderIds.delete(providerRow.id);
  }
}

/** Execute a full sync for a single provider inside an already-created run. */
async function executeSync(providerRow: ProviderRow, runId: number): Promise<SyncResult> {
  const start = Date.now();
  const result = emptyResult(providerRow);

  const config = (providerRow.config ?? {}) as Record<string, unknown>;
  // Jira credentials belong to this job's explicit connection, not to the
  // process. The resolved connection id is stamped onto imported tickets so
  // every later reconcile stays bound to the same tenant. ConnectWise remains
  // the deliberately honest legacy-global exception until its client is
  // de-singletoned.
  let connectionId: number | null;
  let credentials;
  try {
    ({ connectionId, credentials } = await resolveCredentials(
      providerRow.type,
      providerRow.connectionId ?? null
    ));
  } catch (err) {
    result.status = 'error';
    result.errorCount++;
    addIssue(result, `Cannot resolve credentials for ${providerRow.name}: ${(err as Error).message}`);
    result.durationMs = Date.now() - start;
    return result;
  }
  const provider = createTicketProvider(providerRow.type, config, credentials);
  // Two-way providers reconcile existing tickets (conflict-aware) instead of the
  // blind inbound overwrite used for read-only sources.
  const twoWay = provider.canWriteBack === true;
  // Snapshot the outbound backlog before fetching remote tickets. A fetched
  // ticket that fails reconcile is marked `error`; querying the backlog after
  // the fetch would immediately retry that same ticket in the same run and can
  // duplicate a remote note when the first push landed but local stamping did
  // not. Fresh edits that arrive during this run wait for the next one.
  const pendingLocal = twoWay
    ? await prisma.ticket.findMany({
        where: {
          externalProvider: provider.name,
          syncConnectionId: connectionId,
          OR: [
            { syncState: { in: ['pending', 'error'] } },
            // A persisted customer-visible note is the durable outbox. Include
            // it even if an older bug or manual DB edit left the ticket state
            // looking clean, otherwise the comment could be stranded forever.
            { notes: { some: { syncPending: true } } },
          ],
        },
        select: { id: true, externalId: true },
        orderBy: [{ syncState: 'asc' }, { updatedAt: 'asc' }],
        take: 200,
      })
    : [];

  // The next watermark is captured *before* the fetch. Stamping it at the end of
  // the run silently drops anything modified while the run was in progress.
  const runStartedAt = new Date();

  // Incremental: fetch records updated since the last sync, rewound by an
  // overlap margin. Remote search indexes lag their own writes, so a query that
  // starts exactly at the last watermark can miss records that were already
  // committed. Re-seeing a record is free — ingest is keyed by external id.
  const since = providerRow.lastSyncedAt
    ? new Date(providerRow.lastSyncedAt.getTime() - WATERMARK_OVERLAP_MS)
    : undefined;

  let externalTickets: Awaited<ReturnType<TicketProvider['fetchTickets']>> = [];
  try {
    externalTickets = await provider.fetchTickets(since);
  } catch (err) {
    result.status = 'error';
    result.errorCount++;
    const msg = syncRunRepo.sanitizeSyncError(
      `Failed to fetch tickets from ${providerRow.name}: ${(err as Error).message}`
    );
    addIssue(result, msg);
    // Record the provider-level failure. Without this row a misconfigured or
    // rejected provider is indistinguishable from "nothing to sync": the
    // per-ticket loop below never runs, so nothing else would ever be logged.
    await prisma.syncLog
      .create({
        data: {
          providerId: providerRow.id,
          runId,
          direction: 'inbound',
          status: 'error',
          message: msg.slice(0, 2000),
        },
      })
      .catch(() => undefined);
    result.durationMs = Date.now() - start;
    return result;
  }

  // Provider-neutral filtering. Providers may also push part of this down into
  // their native query, but the predicate is re-applied here unconditionally so
  // filtering is correct even for providers that push nothing down.
  let filter: ReturnType<typeof parseSyncFilter> = null;
  try {
    filter = parseSyncFilter(config.filter);
  } catch (err) {
    result.status = 'error';
    result.errorCount++;
    addIssue(result, `Invalid filter for ${providerRow.name}: ${(err as Error).message}`);
    result.durationMs = Date.now() - start;
    return result;
  }
  if (filter) {
    const outOfFilter = externalTickets.filter((ticket) => !matches(ticket, filter));
    if (outOfFilter.length > 0) {
      // Filters scope discovery, not lifecycle tracking. Once a record was
      // imported, keep following it even when it transitions out of the filter
      // (for example an open-only ticket closing remotely).
      const known = await prisma.ticket.findMany({
        where: {
          externalProvider: provider.name,
          syncConnectionId: connectionId,
          externalId: { in: outOfFilter.map((ticket) => ticket.externalId) },
        },
        select: { externalId: true },
      });
      const knownIds = new Set(known.map((ticket) => ticket.externalId));
      externalTickets = externalTickets.filter(
        (ticket) => matches(ticket, filter) || knownIds.has(ticket.externalId)
      );
      result.ticketsFiltered = outOfFilter.length - knownIds.size;
    }
  }

  const source = provider.name as TicketSource;
  // Failures that left no local row behind — the only kind that must pin the
  // incremental watermark (see the update at the end of this function).
  let unrecordedFailures = 0;
  const processedLocalIds = new Set<number>();

  for (const ext of externalTickets) {
    try {
      // Two-way providers: create-if-missing, then reconcile (conflict-aware).
      // A blind overwrite would clobber unsynced local edits, so existing tickets
      // never go through upsertExternal here.
      if (twoWay) {
        // Scoped by connection: two Jira sites can both contain "HELP-1", and
        // matching on provider alone would merge one tenant's issue into the
        // other's ticket.
        const existing = await prisma.ticket.findFirst({
          where: {
            externalId: ext.externalId,
            externalProvider: provider.name,
            syncConnectionId: connectionId,
          },
        });
        let localId: number;
        if (existing) {
          localId = existing.id;
        } else {
          const t = await ticketRepo.create(
            {
              title: ext.title,
              summary: ext.summary,
              description: ext.description,
              status: ext.status,
              priority: ext.priority,
              companyName: ext.companyName,
              assignee: ext.assignee,
              ticketNumber: ext.ticketNumber,
              source,
              externalId: ext.externalId,
              externalProvider: provider.name,
              syncConnectionId: connectionId,
            },
            'system'
          );
          localId = t.id;
          result.ticketsCreated++;
        }

        processedLocalIds.add(localId);
        const r = await twoWaySync.reconcileTicketWithinAccountLock(localId, { remote: ext, actor: 'system' });
        const reconcileMessage = r.message
          ? syncRunRepo.sanitizeSyncError(r.message)
          : undefined;
        result.notesUpserted += r.notesUpserted ?? 0;
        if (r.outcome === 'pulled' || r.outcome === 'pushed') result.ticketsUpdated++;
        if (r.outcome === 'conflict') {
          result.status = 'degraded';
          result.ticketsConflicted++;
          addIssue(result, `Ticket ${ext.externalId}: conflict held for manual resolution`);
        }
        // A reconcile error wrote a sync_log row but never reached the result,
        // so the scheduler stayed silent about tickets that failed to sync.
        if (r.outcome === 'error') {
          result.status = 'degraded';
          result.errorCount++;
          addIssue(result, `Ticket ${ext.externalId}: ${reconcileMessage ?? 'reconcile failed'}`);
        }
        if (r.outcome === 'skipped') {
          result.status = 'degraded';
          result.ticketsSkipped++;
          addIssue(result, `Ticket ${ext.externalId}: ${reconcileMessage ?? 'reconcile skipped'}`);
        }
        // A merged tombstone left alone is the design working, not a fault. It
        // is counted so the run is still an honest inventory of what was seen,
        // but it must not degrade health or raise an issue every single run.
        if (r.outcome === 'merged') result.ticketsSkipped++;

        await prisma.syncLog.create({
          data: {
            providerId: providerRow.id,
            runId,
            externalId: ext.externalId,
            direction: r.outcome === 'pushed' ? 'outbound' : 'inbound',
            status:
              r.outcome === 'error'
                ? 'error'
                : r.outcome === 'conflict' || r.outcome === 'skipped' || r.outcome === 'merged'
                  ? 'skipped'
                  : 'success',
            message: reconcileMessage,
          },
        });
        continue;
      }

      const { created, merged } = await ticketRepo.upsertExternal(
        ext.externalId,
        provider.name,
        {
          title: ext.title,
          summary: ext.summary,
          description: ext.description,
          status: ext.status,
          priority: ext.priority,
          companyName: ext.companyName,
          assignee: ext.assignee,
          ticketNumber: ext.ticketNumber,
          source,
          syncConnectionId: connectionId,
        },
        'system'
      );

      // A merged tombstone was deliberately left untouched, so counting it as an
      // update would overstate what the run actually did — and pulling its notes
      // below would put remote comments on a ticket nobody is watching, when the
      // conversation has moved to the survivor.
      if (merged) {
        result.ticketsSkipped++;
        await prisma.syncLog.create({
          data: {
            providerId: providerRow.id,
            runId,
            externalId: ext.externalId,
            direction: 'inbound',
            status: 'skipped',
            message: 'ticket is merged; local record only',
          },
        });
        continue;
      }

      if (created) {
        result.ticketsCreated++;
      } else {
        result.ticketsUpdated++;
      }

      // Log success
      await prisma.syncLog.create({
        data: {
          providerId: providerRow.id,
          runId,
          externalId: ext.externalId,
          direction: 'inbound',
          status: 'success',
        },
      });

      // Sync notes for this ticket
      try {
        const externalNotes = await provider.fetchNotes(ext.externalId);
        const localTicket = await prisma.ticket.findFirst({
          where: {
            externalId: ext.externalId,
            externalProvider: provider.name,
            syncConnectionId: connectionId,
          },
        });

        if (localTicket) {
          for (const n of externalNotes) {
            // Upsert by external_id to avoid duplicates on re-sync
            const existing = await prisma.note.findFirst({
              where: { ticketId: localTicket.id, externalId: n.externalId },
            });

            if (!existing) {
              await noteRepo.create(
                localTicket.id,
                {
                  content: n.content,
                  author: n.author,
                  noteType: n.noteType,
                  timeStart: n.timeStart,
                  timeStop: n.timeStop,
                  createdAt: n.createdAt,
                  externalId: n.externalId,
                  visibility: localVisibilityForExternalNote(n),
                  via: 'sync',
                },
                'system'
              );
              result.notesUpserted++;
            }
          }
        }
      } catch (noteErr) {
        // Note sync failure is non-fatal — ticket was still synced
        result.status = 'degraded';
        result.errorCount++;
        addIssue(result, `Notes for ${ext.externalId}: ${(noteErr as Error).message}`);
      }
    } catch (err) {
      result.status = 'degraded';
      result.errorCount++;
      const msg = syncRunRepo.sanitizeSyncError(`Ticket ${ext.externalId}: ${(err as Error).message}`);
      addIssue(result, msg);
      unrecordedFailures++;

      await prisma.syncLog.create({
        data: {
          providerId: providerRow.id,
          runId,
          externalId: ext.externalId,
          direction: 'inbound',
          status: 'error',
          message: msg,
        },
      });
    }
  }

  // Two-way providers: also reconcile local edits that the remote query could
  // not have returned. A ticket left 'pending' by a crashed or failed push has
  // an unchanged remote, so it never appears in the incremental search and would
  // otherwise stay unsynced forever.
  if (twoWay) {
    await reconcilePendingLocal(
      providerRow.id,
      runId,
      result,
      pendingLocal.filter((ticket) => !processedLocalIds.has(ticket.id))
    );
  }

  // Advance the watermark only when every record either succeeded or left a
  // durable local trace. Conflicts and per-ticket reconcile errors are safe to
  // move past: they are recorded on the ticket's syncState and retried by
  // reconcilePendingLocal above, independently of the incremental window.
  // A record that failed before a local row existed has no such trace, so the
  // window must stay put or it would never be seen again.
  if (unrecordedFailures === 0) {
    await prisma.syncProvider.updateMany({
      // Scope/account edits increment this revision. An old in-flight run may
      // finish, but it must never re-stamp the cleared watermark for a newer
      // scope and thereby skip that scope's older tickets.
      where: { id: providerRow.id, configRevision: providerRow.configRevision },
      data: { lastSyncedAt: runStartedAt },
    });
  }

  result.durationMs = Date.now() - start;
  return result;
}

/** Reconcile tickets this provider owns that carry unsynced local changes. */
async function reconcilePendingLocal(
  providerId: number,
  runId: number,
  result: SyncResult,
  stuck: Array<{ id: number; externalId: string | null }>
): Promise<void> {
  for (const t of stuck) {
    try {
      const r = await twoWaySync.reconcileTicketWithinAccountLock(t.id, { actor: 'system' });
      const reconcileMessage = r.message
        ? syncRunRepo.sanitizeSyncError(r.message)
        : undefined;
      result.notesUpserted += r.notesUpserted ?? 0;
      if (r.outcome === 'pushed' || r.outcome === 'pulled') result.ticketsUpdated++;
      if (r.outcome === 'error') {
        result.status = 'degraded';
        result.errorCount++;
        addIssue(result, `Ticket ${t.externalId ?? t.id}: ${reconcileMessage ?? 'reconcile failed'}`);
      }
      if (r.outcome === 'conflict') {
        result.status = 'degraded';
        result.ticketsConflicted++;
        addIssue(result, `Ticket ${t.externalId ?? t.id}: conflict held for manual resolution`);
      }
      if (r.outcome === 'skipped') {
        result.status = 'degraded';
        result.ticketsSkipped++;
        addIssue(result, `Ticket ${t.externalId ?? t.id}: ${reconcileMessage ?? 'reconcile skipped'}`);
      }
      await prisma.syncLog.create({
        data: {
          providerId,
          runId,
          externalId: t.externalId,
          internalId: t.id,
          direction: r.outcome === 'pulled' ? 'inbound' : 'outbound',
          status:
            r.outcome === 'error'
              ? 'error'
              : r.outcome === 'conflict' || r.outcome === 'skipped'
                ? 'skipped'
                : 'success',
          message: reconcileMessage,
        },
      });
    } catch (err) {
      result.status = 'degraded';
      result.errorCount++;
      const message = syncRunRepo.sanitizeSyncError(
        `Ticket ${t.externalId ?? t.id}: ${(err as Error).message}`
      );
      addIssue(result, message);
      await prisma.syncLog
        .create({
          data: {
            providerId,
            runId,
            externalId: t.externalId,
            internalId: t.id,
            direction: 'outbound',
            status: 'error',
            message,
          },
        })
        .catch(() => undefined);
    }
  }
}

/** Run sync for all enabled providers. */
export async function runAllSync(context: SyncRunContext): Promise<SyncResult[]> {
  const providers = await prisma.syncProvider.findMany({ where: { enabled: true } });
  const results: SyncResult[] = [];

  for (const p of providers) {
    // Isolate providers: one that throws unexpectedly must not starve the rest.
    try {
      results.push(await runSync(p as Parameters<typeof runSync>[0], context));
    } catch (err) {
      const runId = err instanceof SyncRunFinalizationError ? err.runId : null;
      results.push({
        runId,
        providerId: p.id,
        providerName: p.name,
        status: 'error',
        ticketsCreated: 0,
        ticketsUpdated: 0,
        notesUpserted: 0,
        ticketsFiltered: 0,
        ticketsSkipped: 0,
        ticketsConflicted: 0,
        errorCount: 1,
        errors: [syncRunRepo.sanitizeSyncError(`Sync run failed: ${(err as Error).message}`)],
        durationMs: 0,
      });
    }
  }

  return results;
}
