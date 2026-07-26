jest.mock('../db/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    ticketEvent: { createMany: jest.fn() },
  },
}));

import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import {
  backlogAgeBuckets,
  continuousPercentileReference,
  durationPercentiles,
  metricContextAt,
  slaCompliance,
  timeLoggedByCompany,
  volumeByDay,
} from './ticketEventRepository';

const queryRaw = prisma.$queryRaw as jest.Mock;

function sqlText(query: Prisma.Sql): string {
  return query.strings.join('?');
}

describe('duration percentile contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses PostgreSQL continuous interpolation: [1,2,3,100] => p50 2.5, p90 70.9', () => {
    const values = [1, 2, 3, 100];
    expect(continuousPercentileReference(values, 0.5)).toBe(2.5);
    expect(continuousPercentileReference(values, 0.9)).toBeCloseTo(70.9, 10);
    // The mean is 26.5, which is exactly the outlier-distorted metric this
    // report intentionally does not expose.
    expect(continuousPercentileReference(values, 0.5)).not.toBe(26.5);
  });

  it('delegates p50/p90 aggregation to percentile_cont in Postgres', async () => {
    let aggregateSql = '';
    queryRaw.mockImplementation(async (query: Prisma.Sql) => {
      const text = sqlText(query);
      if (text.includes('percentile_cont')) {
        aggregateSql = text;
        return [{
          response_count: 4,
          response_p50: 2.5,
          response_p90: 70.9,
          resolution_count: 4,
          resolution_p50: 2.5,
          resolution_p90: 70.9,
        }];
      }
      return [{ reconstructed_from: null, reconstructed_through: null }];
    });

    const result = await durationPercentiles({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-08-01T00:00:00Z'),
      companyId: 7,
    });

    expect(result.data.firstResponse).toEqual({
      count: 4,
      p50Minutes: 2.5,
      p90Minutes: 70.9,
    });
    expect(result.data.resolution.p90Minutes).toBe(70.9);
    expect(aggregateSql).toContain('percentile_cont(0.5)');
    expect(aggregateSql).toContain('percentile_cont(0.9)');
    expect(aggregateSql.toLowerCase()).not.toContain('avg(');
    expect(aggregateSql).toContain('outcome.company_id');
  });

  it('recovers point-in-time metric context from state facts in durable order', async () => {
    let contextSql = '';
    queryRaw.mockImplementation(async (query: Prisma.Sql) => {
      contextSql = sqlText(query);
      return [{
        companyId: 7,
        teamId: 3,
        assigneeId: 11,
        priority: 'High',
        status: 'In Progress',
      }];
    });
    const at = new Date('2026-07-10T12:34:56Z');

    await expect(metricContextAt(42, at)).resolves.toEqual({
      companyId: 7,
      teamId: 3,
      assigneeId: 11,
      priority: 'High',
      status: 'In Progress',
      occurredAt: at,
    });

    const compactSql = contextSql.replace(/\s+/g, ' ');
    expect(compactSql).toContain('WITH dimension_context AS');
    expect(compactSql).toContain('status_context AS');
    expect(compactSql).toContain("'assigned'");
    expect(compactSql).toContain("'context_changed'");
    expect(compactSql).not.toContain("'first_response'");
    expect(compactSql).not.toContain("'sla_breached'");
    expect(
      compactSql.match(
        /event\.source_audit_id DESC NULLS LAST, event\.id DESC/g,
      ),
    ).toHaveLength(2);
  });

  it('uses snapshot id to break same-millisecond SLA supersession ties', async () => {
    let complianceSql = '';
    queryRaw.mockImplementation(async (query: Prisma.Sql) => {
      const text = sqlText(query);
      if (text.includes('WITH snapshot_order AS')) {
        complianceSql = text;
        return [];
      }
      return [{ reconstructed_from: null, reconstructed_through: null }];
    });

    await slaCompliance({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-08-01T00:00:00Z'),
    });

    expect(complianceSql).toContain(
      'ORDER BY snapshot.established_at, snapshot.id',
    );
    expect(complianceSql).toContain('lead(snapshot.established_at)');
  });

  it('marks an SLA window that starts before immutable snapshot history', async () => {
    const coverageFrom = new Date('2026-07-15T00:00:00Z');
    queryRaw.mockImplementation(async (query: Prisma.Sql) => {
      const text = sqlText(query);
      if (text.includes('WITH snapshot_order AS')) return [];
      if (text.includes('min(established_at) AS sla_snapshot_coverage_from')) {
        return [{ sla_snapshot_coverage_from: coverageFrom }];
      }
      return [{ reconstructed_from: null, reconstructed_through: null }];
    });

    const result = await slaCompliance({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-08-01T00:00:00Z'),
    });

    expect(result.meta.slaSnapshotCoverageFrom).toEqual(coverageFrom);
    expect(result.meta.includesUnrecordedSlaHistory).toBe(true);
  });

  it('uses UTC-naive timestamps and durable audit order for historical state', async () => {
    let volumeSql = '';
    let backlogSql = '';
    queryRaw.mockImplementation(async (query: Prisma.Sql) => {
      const text = sqlText(query);
      if (text.includes('generate_series')) {
        volumeSql = text;
        return [];
      }
      if (text.includes('latest_state AS')) {
        backlogSql = text;
        return [];
      }
      return [{ reconstructed_from: null, reconstructed_through: null }];
    });
    const filters = {
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-08-01T00:00:00Z'),
    };

    await volumeByDay(filters);
    await backlogAgeBuckets(filters);

    expect(volumeSql).toContain('event.occurred_at::date AS day');
    expect(volumeSql).not.toContain(
      "(event.occurred_at AT TIME ZONE 'UTC')::date",
    );
    const compactBacklogSql = backlogSql.replace(/\s+/g, ' ');
    expect(compactBacklogSql).toContain(
      "ORDER BY event.ticket_id, event.occurred_at DESC, event.source_audit_id DESC NULLS LAST, event.id DESC",
    );
    expect(compactBacklogSql).toContain(
      "::timestamptz AT TIME ZONE 'UTC') - created.occurred_at",
    );
  });

  it('attributes merged time through the note origin ticket event history', async () => {
    let timeSql = '';
    queryRaw.mockImplementation(async (query: Prisma.Sql) => {
      const text = sqlText(query);
      if (text.includes('WITH entries AS')) {
        timeSql = text;
        return [];
      }
      return [{ reconstructed_from: null, reconstructed_through: null }];
    });

    await timeLoggedByCompany({
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-08-01T00:00:00Z'),
    });

    expect(timeSql).toContain(
      'coalesce(note.origin_ticket_id, note.ticket_id)',
    );
    expect(timeSql.replace(/\s+/g, ' ')).toContain(
      'ORDER BY event.occurred_at DESC, event.source_audit_id DESC NULLS LAST, event.id DESC',
    );
  });
});
