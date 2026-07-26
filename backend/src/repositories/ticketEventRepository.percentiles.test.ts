jest.mock('../db/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    ticketEvent: { createMany: jest.fn() },
  },
}));

import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import {
  continuousPercentileReference,
  durationPercentiles,
  slaCompliance,
  timeLoggedByCompany,
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
  });
});
