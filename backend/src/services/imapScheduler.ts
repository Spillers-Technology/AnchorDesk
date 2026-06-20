/**
 * imapScheduler — in-process poller that ingests email-to-ticket from every
 * enabled mailbox on an interval. Single-replica; the mailbox.lastUid cursor is
 * the unit of progress, so moving to a queue later is contained.
 */
import { FastifyBaseLogger } from 'fastify';
import { pollAll } from './imapService';

const POLL_INTERVAL_MS = 120_000;
let timer: NodeJS.Timeout | null = null;

async function tick(log: FastifyBaseLogger) {
  try {
    const results = await pollAll();
    for (const r of results) {
      if (r.error) log.warn(`imap[${r.mailbox}]: ${r.error}`);
      else if (r.processed) log.info(`imap[${r.mailbox}]: ${r.created} new tickets, ${r.appended} replies`);
    }
  } catch (err) {
    log.error(`imapScheduler tick failed: ${err}`);
  }
}

export function startImapScheduler(log: FastifyBaseLogger) {
  if (timer) return;
  timer = setInterval(() => void tick(log), POLL_INTERVAL_MS);
  timer.unref?.();
  log.info(`imapScheduler started (every ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopImapScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
