import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import type { TicketMetricContext } from '../services/realtime/eventBus';

/** Prisma maps PostgreSQL DateTime to UTC-naive TIMESTAMP(3), while raw-query
 * Date parameters are instants. Normalize parameters to the column's UTC-naive
 * representation so comparisons do not depend on the session TimeZone. */
function utcNaiveTimestamp(value: Date): Prisma.Sql {
  return Prisma.sql`(${value}::timestamptz AT TIME ZONE 'UTC')`;
}

export type TicketEventKind =
  | 'created'
  | 'status_changed'
  | 'assigned'
  | 'context_changed'
  | 'first_response'
  | 'resolved'
  | 'reopened'
  | 'merged'
  | 'sla_breached';

export interface AppendTicketEvent {
  ticketId: number;
  kind: TicketEventKind;
  fromValue?: string | null;
  toValue?: string | null;
  actor?: string | null;
  companyId?: number | null;
  teamId?: number | null;
  assigneeId?: number | null;
  priority?: string | null;
  occurredAt: Date;
  /** Decimal AuditLog id captured by the publisher. */
  sourceAuditId?: string;
  /** Deterministic identity for non-audit facts (currently SLA breaches). */
  sourceKey?: string;
}

/** Idempotent append boundary used by the event-bus subscriber. */
export async function append(events: AppendTicketEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const result = await prisma.ticketEvent.createMany({
    data: events.map((event) => ({
      ticketId: event.ticketId,
      kind: event.kind,
      fromValue: event.fromValue ?? null,
      toValue: event.toValue ?? null,
      actor: event.actor ?? null,
      companyId: event.companyId ?? null,
      teamId: event.teamId ?? null,
      assigneeId: event.assigneeId ?? null,
      priority: event.priority ?? null,
      occurredAt: event.occurredAt,
      sourceAuditId: event.sourceAuditId ? BigInt(event.sourceAuditId) : null,
      sourceKey: event.sourceKey ?? null,
    })),
    // The two unique source identities make a repeated publish/backfill a no-op.
    skipDuplicates: true,
  });
  return result.count;
}

interface MetricContextRow {
  companyId: number | null;
  teamId: number | null;
  assigneeId: number | null;
  priority: string | null;
  status: string;
}

/**
 * Recover ticket context at an immutable historical instant without consulting
 * the mutable Ticket row. Dimension-bearing lifecycle facts and status-bearing
 * facts are selected independently because assignment/context events do not
 * overload fromValue/toValue with a status.
 */
export async function metricContextAt(
  ticketId: number,
  at: Date,
): Promise<TicketMetricContext | null> {
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    throw new TypeError('ticketId must be a positive integer');
  }
  if (Number.isNaN(at.getTime())) {
    throw new TypeError('at must be a valid date');
  }
  const atUtc = utcNaiveTimestamp(at);
  const [row] = await prisma.$queryRaw<MetricContextRow[]>(Prisma.sql`
    WITH dimension_context AS (
      SELECT event.company_id,
             event.team_id,
             event.assignee_id,
             event.priority
      FROM ticket_events AS event
      WHERE event.ticket_id = ${ticketId}
        AND event.occurred_at <= ${atUtc}
        AND event.kind IN (
          'created',
          'status_changed',
          'assigned',
          'context_changed',
          'resolved',
          'reopened',
          'merged'
        )
      ORDER BY event.occurred_at DESC,
               event.source_audit_id DESC NULLS LAST,
               event.id DESC
      LIMIT 1
    ),
    status_context AS (
      SELECT CASE
               WHEN event.kind = 'merged' THEN 'Closed'
               ELSE event.to_value
             END AS status
      FROM ticket_events AS event
      WHERE event.ticket_id = ${ticketId}
        AND event.occurred_at <= ${atUtc}
        AND event.kind IN (
          'created',
          'status_changed',
          'resolved',
          'reopened',
          'merged'
        )
        AND (event.kind = 'merged' OR event.to_value IS NOT NULL)
      ORDER BY event.occurred_at DESC,
               event.source_audit_id DESC NULLS LAST,
               event.id DESC
      LIMIT 1
    )
    SELECT dimensions.company_id AS "companyId",
           dimensions.team_id AS "teamId",
           dimensions.assignee_id AS "assigneeId",
           dimensions.priority,
           status.status
    FROM dimension_context AS dimensions
    CROSS JOIN status_context AS status
  `);
  return row ? { ...row, occurredAt: new Date(at) } : null;
}

export interface ReportFilters {
  /** Inclusive UTC instant. */
  from: Date;
  /** Exclusive UTC instant. */
  to: Date;
  companyId?: number;
  teamId?: number;
  assigneeId?: number;
}

export interface ReportMeta {
  from: Date;
  to: Date;
  includesReconstructed: boolean;
  reconstructedFrom: Date | null;
  reconstructedThrough: Date | null;
}

export interface ReportResult<T, M extends ReportMeta = ReportMeta> {
  data: T;
  meta: M;
}

export class InvalidReportRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReportRangeError';
  }
}

function validateFilters(filters: ReportFilters): void {
  if (
    Number.isNaN(filters.from.getTime()) ||
    Number.isNaN(filters.to.getTime()) ||
    filters.from >= filters.to
  ) {
    throw new InvalidReportRangeError('report range must be valid and from must be before to');
  }
  for (const [name, value] of [
    ['companyId', filters.companyId],
    ['teamId', filters.teamId],
    ['assigneeId', filters.assigneeId],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new InvalidReportRangeError(`${name} must be a positive integer`);
    }
  }
}

/** Build predicates over denormalized event/context columns. `alias` is an
 * internal constant supplied only by this module, never caller input. */
function dimensions(alias: string, filters: ReportFilters): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  if (filters.companyId !== undefined) {
    clauses.push(Prisma.sql`${Prisma.raw(`${alias}.company_id`)} = ${filters.companyId}`);
  }
  if (filters.teamId !== undefined) {
    clauses.push(Prisma.sql`${Prisma.raw(`${alias}.team_id`)} = ${filters.teamId}`);
  }
  if (filters.assigneeId !== undefined) {
    clauses.push(Prisma.sql`${Prisma.raw(`${alias}.assignee_id`)} = ${filters.assigneeId}`);
  }
  return clauses.length
    ? Prisma.sql`AND ${Prisma.join(clauses, ' AND ')}`
    : Prisma.empty;
}

async function reportMeta(filters: ReportFilters): Promise<ReportMeta> {
  const [bounds] = await prisma.$queryRaw<
    Array<{ reconstructed_from: Date | null; reconstructed_through: Date | null }>
  >(Prisma.sql`
    SELECT min(occurred_at) AS reconstructed_from,
           max(occurred_at) AS reconstructed_through
    FROM ticket_events
    WHERE actor = 'backfill'
  `);
  const reconstructedFrom = bounds?.reconstructed_from ?? null;
  const reconstructedThrough = bounds?.reconstructed_through ?? null;
  const includesReconstructed = Boolean(
    reconstructedFrom &&
    reconstructedThrough &&
    filters.to > reconstructedFrom &&
    filters.from <= reconstructedThrough,
  );
  return {
    from: filters.from,
    to: filters.to,
    includesReconstructed,
    reconstructedFrom,
    reconstructedThrough,
  };
}

async function withMeta<T>(filters: ReportFilters, query: Promise<T>): Promise<ReportResult<T>> {
  validateFilters(filters);
  const [data, meta] = await Promise.all([query, reportMeta(filters)]);
  return { data, meta };
}

export interface VolumeBucket {
  day: string;
  created: number;
  resolved: number;
}

/** Created vs resolved transition volume, zero-filled into UTC calendar days. */
export function volumeByDay(filters: ReportFilters): Promise<ReportResult<VolumeBucket[]>> {
  validateFilters(filters);
  const dim = dimensions('event', filters);
  const fromUtc = utcNaiveTimestamp(filters.from);
  const toUtc = utcNaiveTimestamp(filters.to);
  const query = prisma.$queryRaw<VolumeBucket[]>(Prisma.sql`
    WITH days AS (
      SELECT generate_series(
        date_trunc('day', ${fromUtc}),
        date_trunc(
          'day',
          ${toUtc} - interval '1 microsecond'
        ),
        interval '1 day'
      )::date AS day
    ),
    counts AS (
      -- Prisma stores DateTime as a UTC-naive TIMESTAMP(3). Casting it directly
      -- is stable in every PostgreSQL session timezone; AT TIME ZONE followed
      -- by ::date would convert the instant back through the session timezone.
      SELECT event.occurred_at::date AS day,
             count(*) FILTER (WHERE event.kind = 'created')::int AS created,
             count(*) FILTER (WHERE event.kind = 'resolved')::int AS resolved
      FROM ticket_events AS event
      WHERE event.occurred_at >= ${fromUtc}
        AND event.occurred_at < ${toUtc}
        AND event.kind IN ('created', 'resolved')
        ${dim}
      GROUP BY 1
    )
    SELECT days.day::text AS day,
           coalesce(counts.created, 0)::int AS created,
           coalesce(counts.resolved, 0)::int AS resolved
    FROM days
    LEFT JOIN counts USING (day)
    ORDER BY days.day
  `);
  return withMeta(filters, query);
}

export interface DurationPercentiles {
  firstResponse: { count: number; p50Minutes: number | null; p90Minutes: number | null };
  resolution: { count: number; p50Minutes: number | null; p90Minutes: number | null };
}

interface DurationRow {
  response_count: number;
  response_p50: number | null;
  response_p90: number | null;
  resolution_count: number;
  resolution_p50: number | null;
  resolution_p90: number | null;
}

/**
 * First completion per ticket, measured from its created fact. The cohort is
 * the outcome occurrence in [from,to); dimensions are those on that outcome.
 * PostgreSQL performs both pairing and continuous-percentile interpolation.
 */
export async function durationPercentiles(
  filters: ReportFilters,
): Promise<ReportResult<DurationPercentiles>> {
  validateFilters(filters);
  const dim = dimensions('outcome', filters);
  const fromUtc = utcNaiveTimestamp(filters.from);
  const toUtc = utcNaiveTimestamp(filters.to);
  const rowsPromise = prisma.$queryRaw<DurationRow[]>(Prisma.sql`
    WITH created AS (
      SELECT DISTINCT ON (ticket_id) ticket_id, occurred_at
      FROM ticket_events
      WHERE kind = 'created'
      ORDER BY ticket_id, occurred_at, source_audit_id NULLS LAST, id
    ),
    first_outcomes AS (
      SELECT DISTINCT ON (event.ticket_id, event.kind)
             event.ticket_id,
             event.kind,
             event.occurred_at,
             event.company_id,
             event.team_id,
             event.assignee_id
      FROM ticket_events AS event
      WHERE event.kind IN ('first_response', 'resolved')
      ORDER BY event.ticket_id, event.kind, event.occurred_at,
               event.source_audit_id NULLS LAST, event.id
    ),
    durations AS (
      SELECT outcome.kind,
             extract(epoch FROM (outcome.occurred_at - created.occurred_at)) / 60.0 AS minutes
      FROM first_outcomes AS outcome
      JOIN created USING (ticket_id)
      WHERE outcome.occurred_at >= ${fromUtc}
        AND outcome.occurred_at < ${toUtc}
        AND outcome.occurred_at >= created.occurred_at
        ${dim}
    )
    SELECT
      count(*) FILTER (WHERE kind = 'first_response')::int AS response_count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
        FILTER (WHERE kind = 'first_response')::double precision AS response_p50,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY minutes)
        FILTER (WHERE kind = 'first_response')::double precision AS response_p90,
      count(*) FILTER (WHERE kind = 'resolved')::int AS resolution_count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes)
        FILTER (WHERE kind = 'resolved')::double precision AS resolution_p50,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY minutes)
        FILTER (WHERE kind = 'resolved')::double precision AS resolution_p90
    FROM durations
  `);
  const result = await withMeta(filters, rowsPromise);
  const row = result.data[0] ?? {
    response_count: 0,
    response_p50: null,
    response_p90: null,
    resolution_count: 0,
    resolution_p50: null,
    resolution_p90: null,
  };
  return {
    data: {
      firstResponse: {
        count: row.response_count,
        p50Minutes: row.response_p50,
        p90Minutes: row.response_p90,
      },
      resolution: {
        count: row.resolution_count,
        p50Minutes: row.resolution_p50,
        p90Minutes: row.resolution_p90,
      },
    },
    meta: result.meta,
  };
}

/** Reference implementation for contract tests only. Production aggregation is
 * the percentile_cont query above, never this Node helper. */
export function continuousPercentileReference(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  if (fraction < 0 || fraction > 1) throw new RangeError('fraction must be between 0 and 1');
  const position = fraction * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export interface SlaComplianceRow {
  kind: 'response' | 'resolution';
  met: number;
  breached: number;
  atRisk: number;
  onTrack: number;
}

export interface SlaComplianceMeta extends ReportMeta {
  /** Earliest immutable SLA promise recorded by the 2.7 snapshot spine. */
  slaSnapshotCoverageFrom: Date | null;
  /** True when part of the requested window predates recorded SLA promises. */
  includesUnrecordedSlaHistory: boolean;
}

interface SlaCoverageRow {
  sla_snapshot_coverage_from: Date | null;
}

/**
 * SLA promises due in the requested window. An uncompleted promise superseded
 * before its deadline is excluded; a completion while that promise was active
 * remains countable. Completion is compared with the frozen due timestamp.
 * `onTrack` is explicit because met/breached/at-risk are not exhaustive.
 */
export async function slaCompliance(
  filters: ReportFilters,
): Promise<ReportResult<SlaComplianceRow[], SlaComplianceMeta>> {
  validateFilters(filters);
  const dim = dimensions('context', filters);
  const cutoff = new Date(Math.min(filters.to.getTime(), Date.now()));
  const fromUtc = utcNaiveTimestamp(filters.from);
  const toUtc = utcNaiveTimestamp(filters.to);
  const cutoffUtc = utcNaiveTimestamp(cutoff);
  const query = prisma.$queryRaw<SlaComplianceRow[]>(Prisma.sql`
    WITH snapshot_order AS (
      SELECT snapshot.*,
             lead(snapshot.established_at) OVER (
               PARTITION BY snapshot.ticket_id
               ORDER BY snapshot.established_at, snapshot.id
             ) AS superseded_at
      FROM ticket_sla_snapshots AS snapshot
    ),
    targets AS (
      SELECT snapshot.id,
             snapshot.ticket_id,
             snapshot.established_at,
             snapshot.superseded_at,
             'response'::text AS kind,
             snapshot.response_due_at AS due_at,
             snapshot.response_minutes AS target_minutes
      FROM snapshot_order AS snapshot
      WHERE snapshot.response_due_at >= ${fromUtc}
        AND snapshot.response_due_at < ${toUtc}
        AND NOT EXISTS (
          SELECT 1 FROM ticket_events AS prior_response
          WHERE prior_response.ticket_id = snapshot.ticket_id
            AND prior_response.kind = 'first_response'
            AND prior_response.occurred_at < snapshot.established_at
        )
      UNION ALL
      SELECT snapshot.id,
             snapshot.ticket_id,
             snapshot.established_at,
             snapshot.superseded_at,
             'resolution'::text AS kind,
             snapshot.resolution_due_at AS due_at,
             snapshot.resolution_minutes AS target_minutes
      FROM snapshot_order AS snapshot
      WHERE snapshot.resolution_due_at >= ${fromUtc}
        AND snapshot.resolution_due_at < ${toUtc}
    ),
    measured AS (
      SELECT target.kind,
             target.due_at,
             target.target_minutes,
             target.superseded_at,
             outcome.occurred_at AS completed_at
      FROM targets AS target
      LEFT JOIN LATERAL (
        SELECT event.company_id, event.team_id, event.assignee_id
        FROM ticket_events AS event
        WHERE event.ticket_id = target.ticket_id
          AND event.occurred_at <= target.established_at
        ORDER BY event.occurred_at DESC,
                 event.source_audit_id DESC NULLS LAST,
                 event.id DESC
        LIMIT 1
      ) AS context ON true
      LEFT JOIN LATERAL (
        SELECT event.occurred_at
        FROM ticket_events AS event
        WHERE event.ticket_id = target.ticket_id
          AND event.kind = CASE WHEN target.kind = 'response' THEN 'first_response' ELSE 'resolved' END
          AND event.occurred_at >= target.established_at
          AND (
            target.superseded_at IS NULL
            OR event.occurred_at < target.superseded_at
          )
          AND event.occurred_at <= ${cutoffUtc}
        ORDER BY event.occurred_at,
                 event.source_audit_id NULLS LAST,
                 event.id
        LIMIT 1
      ) AS outcome ON true
      WHERE true ${dim}
    ),
    classified AS (
      SELECT kind,
             CASE
               WHEN completed_at IS NOT NULL AND completed_at <= due_at THEN 'met'
               WHEN completed_at > due_at OR ${cutoffUtc} >= due_at THEN 'breached'
               WHEN ${cutoffUtc} >= due_at -
                 make_interval(mins => least(greatest(target_minutes * 0.25, 5), 120)::int)
                 THEN 'at_risk'
               ELSE 'on_track'
             END AS result
      FROM measured
      -- An uncompleted promise replaced before its deadline is not judged.
      -- A completion while it was active remains historical fact and is still
      -- counted even if the ticket was legitimately re-targeted afterward.
      WHERE completed_at IS NOT NULL
         OR superseded_at IS NULL
         OR superseded_at > due_at
    ),
    clocks(kind) AS (VALUES ('response'::text), ('resolution'::text))
    SELECT clocks.kind,
           count(*) FILTER (WHERE classified.result = 'met')::int AS met,
           count(*) FILTER (WHERE classified.result = 'breached')::int AS breached,
           count(*) FILTER (WHERE classified.result = 'at_risk')::int AS "atRisk",
           count(*) FILTER (WHERE classified.result = 'on_track')::int AS "onTrack"
    FROM clocks
    LEFT JOIN classified ON classified.kind = clocks.kind
    GROUP BY clocks.kind
    ORDER BY clocks.kind
  `);
  const coverageQuery = prisma.$queryRaw<SlaCoverageRow[]>(Prisma.sql`
    SELECT min(established_at) AS sla_snapshot_coverage_from
    FROM ticket_sla_snapshots
  `);
  const [result, coverageRows] = await Promise.all([
    withMeta(filters, query),
    coverageQuery,
  ]);
  const slaSnapshotCoverageFrom =
    coverageRows[0]?.sla_snapshot_coverage_from ?? null;
  return {
    data: result.data,
    meta: {
      ...result.meta,
      slaSnapshotCoverageFrom,
      // No historical snapshots were fabricated on upgrade. A null boundary
      // therefore means SLA history has not started being recorded at all.
      includesUnrecordedSlaHistory:
        slaSnapshotCoverageFrom === null ||
        filters.from < slaSnapshotCoverageFrom,
    },
  };
}

export interface BacklogAgeBucket {
  bucket: '<1d' | '1-3d' | '3-7d' | '7-30d' | '30d+';
  count: number;
}

/** Point-in-time backlog at `to`; `from` affects provenance, not membership. */
export function backlogAgeBuckets(
  filters: ReportFilters,
): Promise<ReportResult<BacklogAgeBucket[]>> {
  validateFilters(filters);
  const dim = dimensions('context', filters);
  const toUtc = utcNaiveTimestamp(filters.to);
  const query = prisma.$queryRaw<BacklogAgeBucket[]>(Prisma.sql`
    WITH created AS (
      SELECT DISTINCT ON (ticket_id) ticket_id, occurred_at
      FROM ticket_events
      WHERE kind = 'created' AND occurred_at < ${toUtc}
      ORDER BY ticket_id, occurred_at, source_audit_id NULLS LAST, id
    ),
    latest_state AS (
      SELECT DISTINCT ON (event.ticket_id)
             event.ticket_id,
             CASE
               WHEN event.kind = 'merged' THEN 'Closed'
               ELSE event.to_value
             END AS status
      FROM ticket_events AS event
      WHERE event.occurred_at < ${toUtc}
        AND event.kind IN ('created', 'status_changed', 'resolved', 'reopened', 'merged')
      ORDER BY event.ticket_id, event.occurred_at DESC,
               event.source_audit_id DESC NULLS LAST, event.id DESC
    ),
    open_tickets AS (
      SELECT created.ticket_id,
             extract(
               epoch FROM (
                 ${toUtc} -
                 created.occurred_at
               )
             ) / 86400.0 AS age_days
      FROM created
      JOIN latest_state USING (ticket_id)
      LEFT JOIN LATERAL (
        SELECT event.company_id, event.team_id, event.assignee_id
        FROM ticket_events AS event
        WHERE event.ticket_id = created.ticket_id
          AND event.occurred_at < ${toUtc}
        ORDER BY event.occurred_at DESC,
                 event.source_audit_id DESC NULLS LAST,
                 event.id DESC
        LIMIT 1
      ) AS context ON true
      WHERE latest_state.status NOT IN ('Resolved', 'Closed', 'Deleted')
        ${dim}
    ),
    counted AS (
      SELECT CASE
               WHEN age_days < 1 THEN '<1d'
               WHEN age_days < 3 THEN '1-3d'
               WHEN age_days < 7 THEN '3-7d'
               WHEN age_days < 30 THEN '7-30d'
               ELSE '30d+'
             END AS bucket,
             count(*)::int AS count
      FROM open_tickets
      GROUP BY 1
    ),
    buckets(bucket, ordinal) AS (
      VALUES ('<1d'::text, 1), ('1-3d', 2), ('3-7d', 3), ('7-30d', 4), ('30d+', 5)
    )
    SELECT buckets.bucket,
           coalesce(counted.count, 0)::int AS count
    FROM buckets
    LEFT JOIN counted USING (bucket)
    ORDER BY buckets.ordinal
  `);
  return withMeta(filters, query);
}

export interface AssigneeThroughput {
  assigneeId: number | null;
  assigneeName: string | null;
  resolved: number;
}

export function throughputByAssignee(
  filters: ReportFilters,
): Promise<ReportResult<AssigneeThroughput[]>> {
  validateFilters(filters);
  const dim = dimensions('event', filters);
  const fromUtc = utcNaiveTimestamp(filters.from);
  const toUtc = utcNaiveTimestamp(filters.to);
  const query = prisma.$queryRaw<AssigneeThroughput[]>(Prisma.sql`
    SELECT event.assignee_id AS "assigneeId",
           coalesce(app_user.display_name, app_user.username) AS "assigneeName",
           count(*)::int AS resolved
    FROM ticket_events AS event
    LEFT JOIN users AS app_user ON app_user.id = event.assignee_id
    WHERE event.kind = 'resolved'
      AND event.occurred_at >= ${fromUtc}
      AND event.occurred_at < ${toUtc}
      ${dim}
    GROUP BY event.assignee_id, app_user.display_name, app_user.username
    ORDER BY resolved DESC, event.assignee_id NULLS LAST
  `);
  return withMeta(filters, query);
}

export interface TeamThroughput {
  teamId: number | null;
  teamName: string | null;
  resolved: number;
}

export function throughputByTeam(
  filters: ReportFilters,
): Promise<ReportResult<TeamThroughput[]>> {
  validateFilters(filters);
  const dim = dimensions('event', filters);
  const fromUtc = utcNaiveTimestamp(filters.from);
  const toUtc = utcNaiveTimestamp(filters.to);
  const query = prisma.$queryRaw<TeamThroughput[]>(Prisma.sql`
    SELECT event.team_id AS "teamId",
           team.name AS "teamName",
           count(*)::int AS resolved
    FROM ticket_events AS event
    LEFT JOIN teams AS team ON team.id = event.team_id
    WHERE event.kind = 'resolved'
      AND event.occurred_at >= ${fromUtc}
      AND event.occurred_at < ${toUtc}
      ${dim}
    GROUP BY event.team_id, team.name
    ORDER BY resolved DESC, event.team_id NULLS LAST
  `);
  return withMeta(filters, query);
}

export interface CompanyTimeLogged {
  companyId: number | null;
  companyName: string | null;
  minutes: number;
}

/**
 * Time grouped by the ticket company at `workedAt`. The lateral event lookup is
 * deliberate: joining notes to the current Ticket row would retroactively move
 * old billable work when a ticket changes company.
 */
export function timeLoggedByCompany(
  filters: ReportFilters,
): Promise<ReportResult<CompanyTimeLogged[]>> {
  validateFilters(filters);
  const contextDimensions = dimensions('context', {
    ...filters,
    // The assignee filter for time means the technician who logged it, not the
    // ticket's current/then-assignee.
    assigneeId: undefined,
  });
  const authorFilter = filters.assigneeId !== undefined
    ? Prisma.sql`AND note.author_id = ${filters.assigneeId}`
    : Prisma.empty;
  const fromUtc = utcNaiveTimestamp(filters.from);
  const toUtc = utcNaiveTimestamp(filters.to);
  const query = prisma.$queryRaw<CompanyTimeLogged[]>(Prisma.sql`
    WITH entries AS (
      SELECT note.id,
             context.company_id,
             coalesce(
               note.minutes,
               CASE
                 WHEN note.time_start IS NOT NULL AND note.time_stop IS NOT NULL
                   THEN greatest(0, round(extract(epoch FROM (note.time_stop - note.time_start)) / 60.0))::int
                 ELSE 0
               END
             )::int AS minutes
      FROM notes AS note
      LEFT JOIN LATERAL (
        SELECT event.company_id, event.team_id, event.assignee_id
        FROM ticket_events AS event
        WHERE event.ticket_id = coalesce(note.origin_ticket_id, note.ticket_id)
          AND event.occurred_at <= note.worked_at
        ORDER BY event.occurred_at DESC,
                 event.source_audit_id DESC NULLS LAST,
                 event.id DESC
        LIMIT 1
      ) AS context ON true
      WHERE note.note_type = 'time_entry'
        AND note.worked_at >= ${fromUtc}
        AND note.worked_at < ${toUtc}
        ${contextDimensions}
        ${authorFilter}
    )
    SELECT entries.company_id AS "companyId",
           company.name AS "companyName",
           coalesce(sum(entries.minutes), 0)::int AS minutes
    FROM entries
    LEFT JOIN companies AS company ON company.id = entries.company_id
    GROUP BY entries.company_id, company.name
    ORDER BY minutes DESC, entries.company_id NULLS LAST
  `);
  return withMeta(filters, query);
}
