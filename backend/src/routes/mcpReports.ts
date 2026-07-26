import type { UserRole } from '@prisma/client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as reports from '../repositories/ticketEventRepository';
import { daySpread } from '../services/reporting';

const MAX_REPORT_RANGE_MS = 10 * 366 * 24 * 60 * 60 * 1000;
const MAX_DAY_SPREAD_RANGE_MS = 26 * 60 * 60 * 1000;

function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(isError ? { isError: true as const } : {}),
  };
}

function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value, null, 2));
}

function requireAdmin(role: UserRole) {
  return role === 'admin'
    ? null
    : textResult('Requires role: admin', true);
}

interface FilterInput {
  from: string;
  to: string;
  companyId?: number;
  teamId?: number;
  assigneeId?: number;
}

function parseFilters(
  input: FilterInput,
  maxRangeMs = MAX_REPORT_RANGE_MS,
): reports.ReportFilters | ReturnType<typeof textResult> {
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (from >= to) return textResult('from must be before to', true);
  if (to.getTime() - from.getTime() > maxRangeMs) {
    return textResult(
      `report range may not exceed ${Math.floor(maxRangeMs / 86_400_000)} days`,
      true,
    );
  }
  return {
    from,
    to,
    companyId: input.companyId,
    teamId: input.teamId,
    assigneeId: input.assigneeId,
  };
}

function isToolError(
  value: reports.ReportFilters | ReturnType<typeof textResult>,
): value is ReturnType<typeof textResult> {
  return 'content' in value;
}

function assigneeFilterDenied(role: UserRole, filters: reports.ReportFilters) {
  return filters.assigneeId !== undefined && role !== 'admin'
    ? textResult(
        'Assignee-filtered performance reports require role: admin',
        true,
      )
    : null;
}

const reportFilterShape = {
  from: z.string().datetime({ offset: true })
    .describe('Inclusive ISO 8601 instant with timezone'),
  to: z.string().datetime({ offset: true })
    .describe('Exclusive ISO 8601 instant with timezone'),
  companyId: z.number().int().positive().optional(),
  teamId: z.number().int().positive().optional(),
  assigneeId: z.number().int().positive().optional()
    .describe('Administrator-only historical assignee slice'),
};

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerReportTools(
  server: McpServer,
  userId: number,
  role: UserRole,
): void {
  const aggregate = (
    input: FilterInput,
    query: (
      filters: reports.ReportFilters,
    ) => Promise<reports.ReportResult<unknown>>,
  ) => {
    const filters = parseFilters(input);
    if (isToolError(filters)) return Promise.resolve(filters);
    const denied = assigneeFilterDenied(role, filters);
    if (denied) return Promise.resolve(denied);
    return query(filters).then(jsonResult);
  };

  server.tool(
    'report_volume',
    'Created and resolved transition counts in UTC day buckets for [from,to). Answers whether intake is outpacing completed work; response metadata states reconstructed-history overlap.',
    reportFilterShape,
    { title: 'Report ticket volume', ...readOnlyAnnotations },
    async (input) => aggregate(input, reports.volumeByDay),
  );

  server.tool(
    'report_durations',
    'First-response and first-resolution p50/p90 minutes for outcomes in [from,to). No averages are computed; filters use dimensions recorded on the outcome.',
    reportFilterShape,
    { title: 'Report wait-time percentiles', ...readOnlyAnnotations },
    async (input) => aggregate(input, reports.durationPercentiles),
  );

  server.tool(
    'report_sla_compliance',
    'Met, at-risk, breached, and on-track promises due in [from,to), measured only against immutable SLA snapshots. Metadata identifies unrecorded pre-snapshot history.',
    reportFilterShape,
    { title: 'Report SLA compliance', ...readOnlyAnnotations },
    async (input) => aggregate(input, reports.slaCompliance),
  );

  server.tool(
    'report_backlog_age',
    'Point-in-time open-ticket age buckets as of the exclusive `to` instant. `from` affects provenance only; it is not a period total.',
    reportFilterShape,
    { title: 'Report backlog age', ...readOnlyAnnotations },
    async (input) => aggregate(input, reports.backlogAgeBuckets),
  );

  server.tool(
    'report_team_throughput',
    'Resolved transition counts by the team recorded on each resolution in [from,to). Re-resolutions after reopen are distinct completed-work events.',
    reportFilterShape,
    { title: 'Report team throughput', ...readOnlyAnnotations },
    async (input) => aggregate(input, reports.throughputByTeam),
  );

  server.tool(
    'report_assignee_throughput',
    'Administrator-only resolved transition counts by the historical assignee on each resolution in [from,to).',
    reportFilterShape,
    { title: 'Report technician throughput', ...readOnlyAnnotations },
    async (input) => {
      const denied = requireAdmin(role);
      if (denied) return denied;
      const filters = parseFilters(input);
      if (isToolError(filters)) return filters;
      return jsonResult(await reports.throughputByAssignee(filters));
    },
  );

  server.tool(
    'report_time_by_company',
    'Administrator-only billable minutes by the ticket company in force at workedAt. assigneeId means the technician who logged the entry. Returns aggregate data, not a CSV download.',
    reportFilterShape,
    { title: 'Report time by company', ...readOnlyAnnotations },
    async (input) => {
      const denied = requireAdmin(role);
      if (denied) return denied;
      const filters = parseFilters(input);
      if (isToolError(filters)) return filters;
      return jsonResult(await reports.timeLoggedByCompany(filters));
    },
  );

  server.tool(
    'get_time_day_spread',
    'Lay one technician’s recorded time across a local-day [from,to) window. Non-admin callers may read only themselves. The eight-hour target is explicitly an unconfigured v1 default.',
    {
      from: reportFilterShape.from,
      to: reportFilterShape.to,
      assigneeId: z.number().int().positive().optional(),
    },
    { title: 'Get technician day spread', ...readOnlyAnnotations },
    async ({ from, to, assigneeId }) => {
      const filters = parseFilters(
        { from, to },
        MAX_DAY_SPREAD_RANGE_MS,
      );
      if (isToolError(filters)) return filters;
      if (
        assigneeId !== undefined &&
        role !== 'admin' &&
        assigneeId !== userId
      ) {
        return textResult(
          'Technicians and readonly users may only view their own day spread',
          true,
        );
      }
      return jsonResult(
        await daySpread(assigneeId ?? userId, {
          from: filters.from,
          to: filters.to,
        }),
      );
    },
  );

  server.tool(
    'get_ticket_sla_timeline',
    'Read one ticket’s recorded lifecycle beside the immutable SLA targets in force. Omit both bounds for the complete recorded life; provide both for a [from,to) slice.',
    {
      ticketId: z.number().int().positive(),
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
    },
    { title: 'Get ticket SLA timeline', ...readOnlyAnnotations },
    async ({ ticketId, from, to }) => {
      if (Boolean(from) !== Boolean(to)) {
        return textResult('from and to must be provided together', true);
      }
      let range: Pick<reports.ReportFilters, 'from' | 'to'> | undefined;
      if (from && to) {
        const filters = parseFilters({ from, to });
        if (isToolError(filters)) return filters;
        range = { from: filters.from, to: filters.to };
      }
      const timeline = await reports.ticketSlaTimeline(ticketId, range);
      return timeline
        ? jsonResult(timeline)
        : textResult(`Ticket ${ticketId} not found`, true);
    },
  );
}
