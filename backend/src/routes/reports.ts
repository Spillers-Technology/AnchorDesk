import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { requireRole } from '../middleware/auth';
import * as auditRepository from '../repositories/auditRepository';
import * as reports from '../repositories/ticketEventRepository';
import {
  daySpread,
  UnreportableDaySpreadError,
} from '../services/reporting';
import { parseId } from '../util/ids';

interface TicketParam {
  id: string;
}

const REPORT_KEYS = new Set([
  'from',
  'to',
  'companyId',
  'teamId',
  'assigneeId',
]);
const RANGE_KEYS = new Set(['from', 'to']);
const DAY_SPREAD_KEYS = new Set(['from', 'to', 'assigneeId']);
const MAX_REPORT_RANGE_MS = 10 * 366 * 24 * 60 * 60 * 1000;
const MAX_DAY_SPREAD_RANGE_MS = 26 * 60 * 60 * 1000;
const OFFSET_SUFFIX = /(?:[zZ]|[+-]\d{2}:\d{2})$/;

type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function requestUrl(request: FastifyRequest): URL {
  return new URL(request.url, 'http://anchordesk.local');
}

function rejectUnknownOrRepeated(
  request: FastifyRequest,
  allowed: ReadonlySet<string>,
): string | null {
  const params = requestUrl(request).searchParams;
  for (const key of new Set(params.keys())) {
    if (!allowed.has(key)) return `unknown query parameter: ${key}`;
    if (params.getAll(key).length !== 1) return `${key} may only be provided once`;
  }
  return null;
}

function optionalValue(request: FastifyRequest, key: string): string | undefined {
  return requestUrl(request).searchParams.get(key) ?? undefined;
}

function parseInstant(raw: string | undefined, name: string): Parsed<Date> {
  if (!raw) return { ok: false, error: `${name} is required` };
  if (!OFFSET_SUFFIX.test(raw) || Number.isNaN(Date.parse(raw))) {
    return {
      ok: false,
      error: `${name} must be an ISO 8601 datetime with a timezone`,
    };
  }
  return { ok: true, value: new Date(raw) };
}

function parsePositiveId(
  raw: string | undefined,
  name: string,
): Parsed<number | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!/^\d+$/.test(raw)) {
    return { ok: false, error: `${name} must be a positive integer` };
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return { ok: false, error: `${name} must be a positive integer` };
  }
  return { ok: true, value };
}

function parseRange(
  request: FastifyRequest,
  opts: {
    optional?: boolean;
    allowedKeys?: ReadonlySet<string>;
    maxRangeMs?: number;
  } = {},
): Parsed<Pick<reports.ReportFilters, 'from' | 'to'> | undefined> {
  const queryError = rejectUnknownOrRepeated(
    request,
    opts.allowedKeys ?? RANGE_KEYS,
  );
  if (queryError) return { ok: false, error: queryError };

  const rawFrom = optionalValue(request, 'from');
  const rawTo = optionalValue(request, 'to');
  if (opts.optional && rawFrom === undefined && rawTo === undefined) {
    return { ok: true, value: undefined };
  }
  if (rawFrom === undefined || rawTo === undefined) {
    return { ok: false, error: 'from and to must be provided together' };
  }
  const from = parseInstant(rawFrom, 'from');
  if (!from.ok) return from;
  const to = parseInstant(rawTo, 'to');
  if (!to.ok) return to;
  if (from.value >= to.value) {
    return { ok: false, error: 'from must be before to' };
  }
  const maxRangeMs = opts.maxRangeMs ?? MAX_REPORT_RANGE_MS;
  if (to.value.getTime() - from.value.getTime() > maxRangeMs) {
    return {
      ok: false,
      error: `report range may not exceed ${Math.floor(maxRangeMs / 86_400_000)} days`,
    };
  }
  return { ok: true, value: { from: from.value, to: to.value } };
}

export function parseReportFilters(
  request: FastifyRequest,
): Parsed<reports.ReportFilters> {
  const range = parseRange(request, { allowedKeys: REPORT_KEYS });
  if (!range.ok) return range;
  if (!range.value) {
    return { ok: false, error: 'from and to are required' };
  }
  const companyId = parsePositiveId(
    optionalValue(request, 'companyId'),
    'companyId',
  );
  if (!companyId.ok) return companyId;
  const teamId = parsePositiveId(optionalValue(request, 'teamId'), 'teamId');
  if (!teamId.ok) return teamId;
  const assigneeId = parsePositiveId(
    optionalValue(request, 'assigneeId'),
    'assigneeId',
  );
  if (!assigneeId.ok) return assigneeId;
  return {
    ok: true,
    value: {
      ...range.value,
      companyId: companyId.value,
      teamId: teamId.value,
      assigneeId: assigneeId.value,
    },
  };
}

function enforceAssigneeFilterAccess(
  request: FastifyRequest,
  filters: reports.ReportFilters,
  reply: FastifyReply,
): FastifyReply | null {
  if (
    filters.assigneeId !== undefined &&
    request.user.role !== 'admin'
  ) {
    return reply.status(403).send({
      error: 'Assignee-filtered performance reports require role: admin',
    });
  }
  return null;
}

function sendReportError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof reports.InvalidReportRangeError) {
    return reply.status(400).send({ error: error.message });
  }
  if (
    error instanceof reports.UnreportableTimeEntryError ||
    error instanceof UnreportableDaySpreadError
  ) {
    return reply.status(422).send({ error: error.message });
  }
  throw error;
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  // Spreadsheet applications treat these prefixes as formulas even in quoted
  // CSV cells. Company names are user-controlled, so neutralize them.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function timeReportCsv(result: reports.ReportResult<reports.CompanyTimeLogged[]>): string {
  const rows: unknown[][] = [
    [
      'record_type',
      'metadata_key',
      'metadata_value',
      'company_id',
      'company_name',
      'minutes',
    ],
    ['metadata', 'from', result.meta.from.toISOString(), null, null, null],
    ['metadata', 'to', result.meta.to.toISOString(), null, null, null],
    [
      'metadata',
      'includes_reconstructed',
      result.meta.includesReconstructed,
      null,
      null,
      null,
    ],
    [
      'metadata',
      'reconstructed_from',
      result.meta.reconstructedFrom?.toISOString() ?? '',
      null,
      null,
      null,
    ],
    [
      'metadata',
      'reconstructed_through',
      result.meta.reconstructedThrough?.toISOString() ?? '',
      null,
      null,
      null,
    ],
    ...result.data.map((row) => [
      'data',
      null,
      null,
      row.companyId,
      row.companyName ?? 'Unattributed',
      row.minutes,
    ]),
  ];
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export async function reportRoutes(server: FastifyInstance) {
  const staffOnly = {
    preHandler: requireRole('admin', 'technician', 'readonly'),
  };
  const adminOnly = { preHandler: requireRole('admin') };

  const aggregate = <T>(
    query: (filters: reports.ReportFilters) => Promise<T>,
  ) => async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = parseReportFilters(request);
    if (!parsed.ok) return reply.status(400).send({ error: parsed.error });
    const denied = enforceAssigneeFilterAccess(request, parsed.value, reply);
    if (denied) return denied;
    try {
      return reply.send(await query(parsed.value));
    } catch (error) {
      return sendReportError(error, reply);
    }
  };

  server.get(
    '/reports/volume',
    staffOnly,
    aggregate(reports.volumeByDay),
  );
  server.get(
    '/reports/durations',
    staffOnly,
    aggregate(reports.durationPercentiles),
  );
  server.get(
    '/reports/sla-compliance',
    staffOnly,
    aggregate(reports.slaCompliance),
  );
  server.get(
    '/reports/backlog-age',
    staffOnly,
    aggregate(reports.backlogAgeBuckets),
  );
  server.get(
    '/reports/throughput/team',
    staffOnly,
    aggregate(reports.throughputByTeam),
  );
  server.get(
    '/reports/feedback',
    staffOnly,
    aggregate(reports.feedbackBreakdown),
  );

  server.get(
    '/reports/throughput/assignee',
    adminOnly,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = parseReportFilters(request);
      if (!parsed.ok) return reply.status(400).send({ error: parsed.error });
      try {
        return reply.send(await reports.throughputByAssignee(parsed.value));
      } catch (error) {
        return sendReportError(error, reply);
      }
    },
  );

  server.get(
    '/reports/time-by-company',
    adminOnly,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = parseReportFilters(request);
      if (!parsed.ok) return reply.status(400).send({ error: parsed.error });
      try {
        return reply.send(await reports.timeLoggedByCompany(parsed.value));
      } catch (error) {
        return sendReportError(error, reply);
      }
    },
  );

  server.get(
    '/reports/time-by-company.csv',
    adminOnly,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = parseReportFilters(request);
      if (!parsed.ok) return reply.status(400).send({ error: parsed.error });
      try {
        const result = await reports.timeLoggedByCompany(parsed.value);
        await auditRepository.record({
          entityType: 'report_export',
          entityId: request.user.id,
          action: 'export',
          changedBy: request.actorSub,
          newValue: {
            report: 'time_by_company',
            format: 'csv',
            from: result.meta.from.toISOString(),
            to: result.meta.to.toISOString(),
            companyId: parsed.value.companyId ?? null,
            teamId: parsed.value.teamId ?? null,
            assigneeId: parsed.value.assigneeId ?? null,
            includesReconstructed: result.meta.includesReconstructed,
            rows: result.data.length,
          },
        });
        return reply
          .type('text/csv; charset=utf-8')
          .header(
            'Content-Disposition',
            'attachment; filename="anchordesk-time-by-company.csv"',
          )
          .header('X-AnchorDesk-Report-From', result.meta.from.toISOString())
          .header('X-AnchorDesk-Report-To', result.meta.to.toISOString())
          .header(
            'X-AnchorDesk-Includes-Reconstructed',
            String(result.meta.includesReconstructed),
          )
          .header(
            'X-AnchorDesk-Reconstructed-From',
            result.meta.reconstructedFrom?.toISOString() ?? '',
          )
          .header(
            'X-AnchorDesk-Reconstructed-Through',
            result.meta.reconstructedThrough?.toISOString() ?? '',
          )
          .send(timeReportCsv(result));
      } catch (error) {
        return sendReportError(error, reply);
      }
    },
  );

  server.get<{ Params: TicketParam }>(
    '/tickets/:id/sla-timeline',
    staffOnly,
    async (request, reply) => {
      const ticketId = parseId(request.params.id);
      if (ticketId === null) {
        return reply.status(400).send({ error: 'invalid ticket id' });
      }
      const range = parseRange(request, {
        optional: true,
        allowedKeys: RANGE_KEYS,
      });
      if (!range.ok) return reply.status(400).send({ error: range.error });
      try {
        const timeline = await reports.ticketSlaTimeline(
          ticketId,
          range.value,
        );
        if (!timeline) {
          return reply.status(404).send({ error: 'Ticket not found' });
        }
        return reply.send(timeline);
      } catch (error) {
        return sendReportError(error, reply);
      }
    },
  );

  server.get(
    '/time/day-spread',
    staffOnly,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const range = parseRange(request, {
        allowedKeys: DAY_SPREAD_KEYS,
        maxRangeMs: MAX_DAY_SPREAD_RANGE_MS,
      });
      if (!range.ok) {
        return reply.status(400).send({
          error: range.error,
        });
      }
      if (!range.value) {
        return reply.status(400).send({
          error: 'from and to are required',
        });
      }
      const requestedAssignee = parsePositiveId(
        optionalValue(request, 'assigneeId'),
        'assigneeId',
      );
      if (!requestedAssignee.ok) {
        return reply.status(400).send({ error: requestedAssignee.error });
      }
      if (
        requestedAssignee.value !== undefined &&
        request.user.role !== 'admin' &&
        requestedAssignee.value !== request.user.id
      ) {
        return reply.status(403).send({
          error: 'Technicians and readonly users may only view their own day spread',
        });
      }
      const assigneeId = requestedAssignee.value ?? request.user.id;
      try {
        return reply.send(await daySpread(assigneeId, range.value));
      } catch (error) {
        return sendReportError(error, reply);
      }
    },
  );
}
