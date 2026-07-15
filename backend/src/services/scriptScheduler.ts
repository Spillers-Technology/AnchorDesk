/**
 * scriptScheduler — in-process poller that runs due scheduled script jobs.
 *
 * Every interval it picks up queued jobs whose scheduledFor has passed and
 * executes them. Good enough for a single-replica deployment; if this ever runs
 * multi-replica, move to a real queue (the ScriptJob row is already the unit of
 * work, so the migration is contained).
 */

import { FastifyBaseLogger } from 'fastify';
import * as scriptJobRepo from '../repositories/scriptJobRepository';
import { execute, refresh } from './scriptService';

const POLL_INTERVAL_MS = 60_000;
let timer: NodeJS.Timeout | null = null;

async function tick(log: FastifyBaseLogger) {
  try {
    const due = await scriptJobRepo.dueJobs();
    for (const job of due) {
      log.info(`scriptScheduler: running due job ${job.id} (device ${job.deviceId})`);
      await execute(job.id).catch((err) => log.error(`scriptScheduler job ${job.id} failed: ${err}`));
    }
    // Refresh provider-acknowledged async runs (notably Datto) by invocation id.
    // This path can only poll; it never calls run() and therefore cannot duplicate
    // a remote execution after a restart or overlapping scheduler tick.
    const running = await scriptJobRepo.runningJobs();
    for (const job of running) {
      await refresh(job.id).catch((err) => log.error(`scriptScheduler refresh ${job.id} failed: ${err}`));
    }
  } catch (err) {
    log.error(`scriptScheduler tick failed: ${err}`);
  }
}

export function startScriptScheduler(log: FastifyBaseLogger) {
  if (timer) return;
  timer = setInterval(() => void tick(log), POLL_INTERVAL_MS);
  // Don't keep the event loop alive solely for the scheduler.
  timer.unref?.();
  log.info(`scriptScheduler started (every ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopScriptScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
