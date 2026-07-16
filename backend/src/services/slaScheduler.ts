/**
 * slaScheduler — periodically evaluates SLA clocks on open tickets and emits
 * `sla.atRisk` events (warning before a deadline, breached after it). The
 * notification service turns those into per-user alerts; the WebSocket hub pushes
 * them live so SLA chips can react without a refresh.
 *
 * Two clocks per ticket:
 *  - response   — active until firstRespondedAt is set
 *  - resolution — active until the ticket reaches a terminal status
 *
 * A manual ticket deadline (dueAt) overrides the SLA resolution target — see
 * effectiveResolutionDueAt. Note: editing a deadline does not reset the dedupe
 * set, so an alert that already fired for a ticket's resolution clock won't
 * re-fire until restart (same limitation as an SLA recompute).
 *
 * An in-memory set dedupes alerts so each (ticket, clock, level) fires once per
 * process lifetime instead of every tick. Single-replica, like the other
 * schedulers; back the dedupe set with the DB if you scale out.
 */
import { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db/prisma';
import { publish } from './realtime/eventBus';
import { effectiveResolutionDueAt } from './sla';

const POLL_INTERVAL_MS = 60_000;
const TERMINAL_STATUSES = ['Closed', 'Resolved', 'Completed', 'Cancelled', 'Deleted'];
let timer: NodeJS.Timeout | null = null;

// Remembers which alerts already fired: key = `${ticketId}:${kind}:${level}`.
const alerted = new Set<string>();

type Clock = 'response' | 'resolution';
type Level = 'warning' | 'breached';

/** Warning lead time: 25% of the total window, clamped to [5, 120] minutes. */
function warningLeadMs(createdAt: Date, dueAt: Date): number {
  const total = dueAt.getTime() - createdAt.getTime();
  return Math.min(Math.max(total * 0.25, 5 * 60_000), 120 * 60_000);
}

function evaluate(createdAt: Date, dueAt: Date, now: number): Level | null {
  if (now >= dueAt.getTime()) return 'breached';
  if (now >= dueAt.getTime() - warningLeadMs(createdAt, dueAt)) return 'warning';
  return null;
}

function fire(ticketId: number, kind: Clock, level: Level) {
  // A breach supersedes a prior warning for the same clock.
  const key = `${ticketId}:${kind}:${level}`;
  if (alerted.has(key)) return;
  if (level === 'breached') alerted.add(`${ticketId}:${kind}:warning`); // suppress late warnings
  alerted.add(key);
  publish({ type: 'sla.atRisk', ticketId, kind, level });
}

async function tick(log: FastifyBaseLogger) {
  try {
    const now = Date.now();
    const tickets = await prisma.ticket.findMany({
      where: {
        status: { notIn: TERMINAL_STATUSES },
        OR: [
          { responseDueAt: { not: null } },
          { resolutionDueAt: { not: null } },
          { dueAt: { not: null } },
        ],
      },
      select: {
        id: true,
        createdAt: true,
        firstRespondedAt: true,
        responseDueAt: true,
        resolutionDueAt: true,
        dueAt: true,
      },
    });

    for (const t of tickets) {
      if (!t.firstRespondedAt && t.responseDueAt) {
        const level = evaluate(t.createdAt, t.responseDueAt, now);
        if (level) fire(t.id, 'response', level);
      }
      const resolutionDue = effectiveResolutionDueAt(t);
      if (resolutionDue) {
        const level = evaluate(t.createdAt, resolutionDue, now);
        if (level) fire(t.id, 'resolution', level);
      }
    }
  } catch (err) {
    log.error(`slaScheduler tick failed: ${err}`);
  }
}

export function startSlaScheduler(log: FastifyBaseLogger) {
  if (timer) return;
  timer = setInterval(() => void tick(log), POLL_INTERVAL_MS);
  timer.unref?.();
  log.info(`slaScheduler started (every ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopSlaScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
