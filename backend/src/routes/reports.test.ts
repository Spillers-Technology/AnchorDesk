jest.mock('../repositories/ticketEventRepository', () => {
  const actual = jest.requireActual('../repositories/ticketEventRepository');
  return {
    ...actual,
    volumeByDay: jest.fn(),
    durationPercentiles: jest.fn(),
    slaCompliance: jest.fn(),
    backlogAgeBuckets: jest.fn(),
    throughputByAssignee: jest.fn(),
    throughputByTeam: jest.fn(),
    timeLoggedByCompany: jest.fn(),
    ticketSlaTimeline: jest.fn(),
  };
});
jest.mock('../repositories/auditRepository', () => ({
  record: jest.fn(),
}));
jest.mock('../services/reporting', () => {
  const actual = jest.requireActual('../services/reporting');
  return { ...actual, daySpread: jest.fn() };
});
jest.mock('../middleware/auth', () => ({
  requireRole:
    (...roles: string[]) =>
    async (
      request: { user?: { role?: string } },
      reply: {
        status: (code: number) => { send: (body: unknown) => unknown };
      },
    ) => {
      if (!request.user || !roles.includes(String(request.user.role))) {
        return reply
          .status(request.user ? 403 : 401)
          .send({
            error: request.user
              ? `Requires role: ${roles.join(' or ')}`
              : 'Authentication required',
          });
      }
    },
}));

import type { UserRole } from '@prisma/client';
import Fastify from 'fastify';
import * as auditRepository from '../repositories/auditRepository';
import * as reports from '../repositories/ticketEventRepository';
import * as reportingService from '../services/reporting';
import { reportRoutes } from './reports';

const mockedReports = jest.mocked(reports);
const mockedAudit = jest.mocked(auditRepository);
const mockedDaySpread = reportingService.daySpread as jest.Mock;

const from = new Date('2026-07-01T00:00:00.000Z');
const to = new Date('2026-08-01T00:00:00.000Z');
const meta = {
  from,
  to,
  includesReconstructed: true,
  reconstructedFrom: new Date('2025-01-01T00:00:00.000Z'),
  reconstructedThrough: new Date('2026-07-15T00:00:00.000Z'),
};
const query = 'from=2026-07-01T00%3A00%3A00Z&to=2026-08-01T00%3A00%3A00Z';

async function appFor(role: UserRole, id = 7) {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.user = {
      id,
      username: role,
      displayName: role,
      email: null,
      role,
      authProvider: 'local',
      themePref: null,
      kanbanColumns: null,
    };
    request.actorSub = `${role}-actor`;
    request.authChannel = 'web';
  });
  await app.register(reportRoutes);
  await app.ready();
  return app;
}

describe('report REST contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedReports.volumeByDay.mockResolvedValue({ data: [], meta });
    mockedReports.durationPercentiles.mockResolvedValue({
      data: {
        firstResponse: { count: 0, p50Minutes: null, p90Minutes: null },
        resolution: { count: 0, p50Minutes: null, p90Minutes: null },
      },
      meta,
    });
    mockedReports.slaCompliance.mockResolvedValue({
      data: [],
      meta: {
        ...meta,
        slaSnapshotCoverageFrom: null,
        includesUnrecordedSlaHistory: true,
      },
    });
    mockedReports.backlogAgeBuckets.mockResolvedValue({ data: [], meta });
    mockedReports.throughputByTeam.mockResolvedValue({ data: [], meta });
    mockedReports.throughputByAssignee.mockResolvedValue({ data: [], meta });
    mockedReports.timeLoggedByCompany.mockResolvedValue({ data: [], meta });
  });

  it.each([
    [
      'an offset-free instant',
      '/reports/volume?from=2026-07-01T00%3A00%3A00&to=2026-08-01T00%3A00%3A00Z',
      /timezone/,
    ],
    [
      'a repeated filter',
      `/reports/volume?${query}&companyId=1&companyId=2`,
      /only be provided once/,
    ],
    [
      'an unknown filter',
      `/reports/volume?${query}&status=Open`,
      /unknown query parameter/,
    ],
    [
      'a backwards range',
      '/reports/volume?from=2026-08-01T00%3A00%3A00Z&to=2026-07-01T00%3A00%3A00Z',
      /from must be before to/,
    ],
  ])('rejects %s before running SQL', async (_case, url, expected) => {
    const app = await appFor('readonly');
    try {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(expected);
      expect(mockedReports.volumeByDay).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('allows readonly users to read general aggregates and preserves filters', async () => {
    const app = await appFor('readonly');
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/reports/volume?${query}&companyId=3&teamId=4`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().meta.includesReconstructed).toBe(true);
      expect(mockedReports.volumeByDay).toHaveBeenCalledWith({
        from,
        to,
        companyId: 3,
        teamId: 4,
        assigneeId: undefined,
      });
    } finally {
      await app.close();
    }
  });

  it('keeps assignee performance filters and reports admin-only', async () => {
    const app = await appFor('technician');
    try {
      const filtered = await app.inject({
        method: 'GET',
        url: `/reports/volume?${query}&assigneeId=7`,
      });
      expect(filtered.statusCode).toBe(403);
      expect(mockedReports.volumeByDay).not.toHaveBeenCalled();

      for (const path of [
        '/reports/throughput/assignee',
        '/reports/time-by-company',
        '/reports/time-by-company.csv',
      ]) {
        const response = await app.inject({
          method: 'GET',
          url: `${path}?${query}`,
        });
        expect(response.statusCode).toBe(403);
      }
      expect(mockedReports.throughputByAssignee).not.toHaveBeenCalled();
      expect(mockedReports.timeLoggedByCompany).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('exports self-describing CSV, neutralizes formulas, and audits the disclosure', async () => {
    mockedReports.timeLoggedByCompany.mockResolvedValue({
      data: [
        { companyId: 3, companyName: '=2+2', minutes: 125 },
        { companyId: null, companyName: null, minutes: 15 },
      ],
      meta,
    });
    mockedAudit.record.mockResolvedValue(undefined as never);
    const app = await appFor('admin');
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/reports/time-by-company.csv?${query}&companyId=3`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/csv/);
      expect(response.headers['x-anchordesk-includes-reconstructed']).toBe(
        'true',
      );
      expect(response.body).toContain(
        '"metadata","includes_reconstructed","true"',
      );
      expect(response.body).toContain(`"data","","","3","'=2+2","125"`);
      expect(response.body).toContain(
        '"data","","","","Unattributed","15"',
      );
      expect(mockedAudit.record).toHaveBeenCalledWith({
        entityType: 'report_export',
        entityId: 7,
        action: 'export',
        changedBy: 'admin-actor',
        newValue: expect.objectContaining({
          report: 'time_by_company',
          format: 'csv',
          companyId: 3,
          includesReconstructed: true,
          rows: 2,
        }),
      });
    } finally {
      await app.close();
    }
  });

  it('fails closed with 422 when billing duration cannot be computed truthfully', async () => {
    mockedReports.timeLoggedByCompany.mockRejectedValue(
      new reports.UnreportableTimeEntryError(2),
    );
    const app = await appFor('admin');
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/reports/time-by-company?${query}`,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error).toContain('2 time entries');
    } finally {
      await app.close();
    }
  });
});

describe('TIME REST contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedReports.ticketSlaTimeline.mockResolvedValue({
      data: {
        ticket: {
          id: 42,
          ticketNumber: 'HD-42',
          title: 'Printer',
          status: 'In Progress',
          createdAt: from,
          updatedAt: to,
        },
        events: [],
        targets: [],
      },
      meta: { ...meta, rangeDerived: true },
    });
    mockedDaySpread.mockResolvedValue({
      data: {
        assigneeId: 7,
        entries: [],
        target: {
          minutes: 480,
          source: 'default_8h',
          label: 'Default 09:00–17:00 local day (no staff schedule is configured)',
          startLocal: '09:00',
          endLocal: '17:00',
        },
        summary: {
          count: 0,
          loggedMinutes: 0,
          placedMinutes: 0,
          placedCoverageMinutes: 0,
          unplacedMinutes: 0,
          unloggedMinutes: 480,
          firstStart: null,
          lastStop: null,
        },
      },
      meta,
    });
  });

  it('derives a full ticket timeline when both range bounds are omitted', async () => {
    const app = await appFor('technician');
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/tickets/42/sla-timeline',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().meta.rangeDerived).toBe(true);
      expect(mockedReports.ticketSlaTimeline).toHaveBeenCalledWith(
        42,
        undefined,
      );

      const halfRange = await app.inject({
        method: 'GET',
        url: '/tickets/42/sla-timeline?from=2026-07-01T00%3A00%3A00Z',
      });
      expect(halfRange.statusCode).toBe(400);
      expect(mockedReports.ticketSlaTimeline).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('limits non-admin day spread to self while admins may select a technician', async () => {
    const technician = await appFor('technician');
    try {
      const own = await technician.inject({
        method: 'GET',
        url: `/time/day-spread?${query}`,
      });
      expect(own.statusCode).toBe(200);
      expect(mockedDaySpread).toHaveBeenCalledWith(7, { from, to });

      mockedDaySpread.mockClear();
      const other = await technician.inject({
        method: 'GET',
        url: `/time/day-spread?${query}&assigneeId=8`,
      });
      expect(other.statusCode).toBe(403);
      expect(mockedDaySpread).not.toHaveBeenCalled();
    } finally {
      await technician.close();
    }

    const admin = await appFor('admin');
    try {
      const selected = await admin.inject({
        method: 'GET',
        url: `/time/day-spread?${query}&assigneeId=8`,
      });
      expect(selected.statusCode).toBe(200);
      expect(mockedDaySpread).toHaveBeenCalledWith(8, { from, to });
    } finally {
      await admin.close();
    }
  });
});
