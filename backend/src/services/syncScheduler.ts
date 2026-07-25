/**
 * syncScheduler — in-process poller that runs every enabled ticket sync provider
 * on an interval. Mirrors imapScheduler: single-replica, with the provider's
 * lastSyncedAt column as the unit of progress, so moving to a queue later is
 * contained.
 *
 * Without this, runAllSync() was only reachable from POST /sync/run — sync ran
 * only when a human clicked the button in the Sync view.
 */
import { FastifyBaseLogger } from 'fastify';
import { runAllSync } from './syncService';

const DEFAULT_INTERVAL_MS = 300_000; // 5 minutes
const MIN_INTERVAL_MS = 60_000;
/** setInterval delays above the 32-bit signed max silently collapse to 1ms. */
const MAX_INTERVAL_MS = 2_147_483_647;
/** Escalate to an error log once a run has been held this long. The run is never
 *  abandoned: starting a second one concurrently would let two reconcilers push
 *  the same unsynced note and create duplicate remote comments. Every outbound
 *  HTTP call carries its own timeout, so a run cannot hang indefinitely. */
const RUN_STALL_WARN_MS = 15 * 60_000;

function intervalMs(log: FastifyBaseLogger): number {
  const raw = process.env.SYNC_INTERVAL_MS;
  if (raw === undefined || raw === '') return DEFAULT_INTERVAL_MS;

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_INTERVAL_MS || parsed > MAX_INTERVAL_MS) {
    log.warn(
      `syncScheduler: SYNC_INTERVAL_MS="${raw}" is outside [${MIN_INTERVAL_MS}, ${MAX_INTERVAL_MS}]; ` +
        `using ${DEFAULT_INTERVAL_MS}ms`
    );
    return DEFAULT_INTERVAL_MS;
  }
  return parsed;
}

let timer: NodeJS.Timeout | null = null;
let runStartedAt: number | null = null;

export async function runSyncSchedulerTick(log: FastifyBaseLogger) {
  // A slow provider must not stack overlapping runs on top of itself — but a run
  // that never settles must not silence the scheduler forever either.
  if (runStartedAt !== null) {
    const heldSec = Math.round((Date.now() - runStartedAt) / 1000);
    const msg = `syncScheduler: previous run still in progress (${heldSec}s), skipping tick`;
    if (heldSec * 1000 >= RUN_STALL_WARN_MS) log.error(`${msg} — run appears stalled`);
    else log.warn(msg);
    return;
  }
  runStartedAt = Date.now();
  try {
    const results = await runAllSync({ trigger: 'scheduled', actor: 'system' });
    for (const r of results) {
      const issueCount = r.errorCount + r.ticketsConflicted + r.ticketsSkipped;
      if (r.status !== 'success' || issueCount > 0) {
        const sample = r.errors.at(-1);
        log.warn(
          `sync[${r.providerName}]: ${r.status}, ${issueCount} issue(s)` +
            (sample ? ` — ${sample}` : '')
        );
      }
      if (r.ticketsCreated || r.ticketsUpdated || r.notesUpserted) {
        log.info(
          `sync[${r.providerName}]: ${r.ticketsCreated} created, ${r.ticketsUpdated} updated, ` +
            `${r.notesUpserted} notes (${r.durationMs}ms)`
        );
      }
    }
  } catch (err) {
    log.error(`syncScheduler tick failed: ${err}`);
  } finally {
    runStartedAt = null;
  }
}

export function startSyncScheduler(log: FastifyBaseLogger) {
  if (timer) return;
  const ms = intervalMs(log);
  timer = setInterval(() => void runSyncSchedulerTick(log), ms);
  timer.unref?.();
  log.info(`syncScheduler started (every ${ms / 1000}s)`);
}

export function stopSyncScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  runStartedAt = null;
}
