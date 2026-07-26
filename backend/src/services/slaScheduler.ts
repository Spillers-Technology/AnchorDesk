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
 * effectiveResolutionDueAt. Frozen snapshot identity distinguishes legitimate
 * SLA re-targets even when two policies happen to produce the same deadline.
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

function fire(
  ticket: {
    id: number;
    companyId: number | null;
    teamId: number | null;
    assigneeId: number | null;
    priority: string | null;
    status: string;
  },
  kind: Clock,
  level: Level,
  dueAt: Date,
  targetSource: 'sla' | 'manual',
  occurredAt: Date,
  targetIdentity: string,
) {
  // A breach supersedes a prior warning for the same clock.
  // The target is part of the key: a legitimate re-target may warn/breach
  // again, while a process restart converges on the subscriber's DB key.
  const targetKey = `${ticket.id}:${kind}:${targetIdentity}`;
  const key = `${targetKey}:${level}`;
  if (alerted.has(key)) return;
  if (level === 'breached') alerted.add(`${targetKey}:warning`); // suppress late warnings
  alerted.add(key);
  publish({
    type: 'sla.atRisk',
    ticketId: ticket.id,
    kind,
    level,
    dueAt,
    targetSource,
    targetIdentity,
    metricContext: {
      companyId: ticket.companyId,
      teamId: ticket.teamId,
      assigneeId: ticket.assigneeId,
      priority: ticket.priority,
      status: ticket.status,
      occurredAt,
    },
  });
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
        companyId: true,
        teamId: true,
        assigneeId: true,
        priority: true,
        status: true,
        createdAt: true,
        firstRespondedAt: true,
        responseDueAt: true,
        resolutionDueAt: true,
        dueAt: true,
      },
    });
    const snapshots = tickets.length
      ? await prisma.ticketSlaSnapshot.findMany({
          where: { ticketId: { in: tickets.map((ticket) => ticket.id) } },
          orderBy: [
            { ticketId: 'asc' },
            { establishedAt: 'desc' },
            { id: 'desc' },
          ],
          select: {
            id: true,
            ticketId: true,
            responseDueAt: true,
            resolutionDueAt: true,
          },
        })
      : [];
    const latestSnapshot = new Map<number, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) {
      if (!latestSnapshot.has(snapshot.ticketId)) {
        latestSnapshot.set(snapshot.ticketId, snapshot);
      }
    }

    for (const t of tickets) {
      const snapshot = latestSnapshot.get(t.id);
      if (!t.firstRespondedAt && t.responseDueAt) {
        const level = evaluate(t.createdAt, t.responseDueAt, now);
        if (level) {
          const targetIdentity =
            snapshot?.responseDueAt?.getTime() === t.responseDueAt.getTime()
              ? `snapshot:${snapshot.id}`
              : `due:${t.responseDueAt.toISOString()}`;
          fire(
            t,
            'response',
            level,
            t.responseDueAt,
            'sla',
            new Date(now),
            targetIdentity,
          );
        }
      }
      const resolutionDue = effectiveResolutionDueAt(t);
      if (resolutionDue) {
        const level = evaluate(t.createdAt, resolutionDue, now);
        if (level) {
          fire(
            t,
            'resolution',
            level,
            resolutionDue,
            t.dueAt ? 'manual' : 'sla',
            new Date(now),
            t.dueAt
              ? `manual:${resolutionDue.toISOString()}`
              : snapshot?.resolutionDueAt?.getTime() === resolutionDue.getTime()
                ? `snapshot:${snapshot.id}`
                : `due:${resolutionDue.toISOString()}`,
          );
        }
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
