import { prisma } from '../src/db/prisma';
import { backfillTicketEvents } from '../src/db/dataMigrations';
import { ensureReportingSpineInvariants } from '../src/db/pgExtras';
import {
  backlogAgeBuckets,
  durationPercentiles,
  metricContextAt,
  slaCompliance,
  throughputByAssignee,
  throughputByTeam,
  timeLoggedByCompany,
  volumeByDay,
} from '../src/repositories/ticketEventRepository';

if (process.env.ANCHORDESK_POSTGRES_INTEGRATION !== '1') {
  throw new Error(
    'PostgreSQL integration tests must be run through `npm run test:postgres`',
  );
}

const BACKFILL_TICKET_ID = 8_700_001;
const DURATION_TICKET_BASE = 8_710_000;

describe('Workstream A against real PostgreSQL', () => {
  beforeAll(async () => {
    // This compiles the PL/pgSQL trigger body, catalog-verifies both unique
    // source identities, and installs the append-only guards before fixtures
    // are written.
    await ensureReportingSpineInvariants();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('backfills audit history once, labels it honestly, and inserts nothing on rerun', async () => {
    const createdAt = new Date('2037-01-05T10:00:00.000Z');
    const respondedAt = new Date('2037-01-05T10:10:00.000Z');
    const resolvedAt = new Date('2037-01-05T10:20:00.000Z');
    const ticketContext = {
      id: BACKFILL_TICKET_ID,
      title: 'Backfill integration fixture',
      status: 'New',
      priority: 'High',
      companyId: 701,
      teamId: 702,
      assigneeId: 703,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    };

    const createdAudit = await prisma.auditLog.create({
      data: {
        entityType: 'ticket',
        entityId: BACKFILL_TICKET_ID,
        action: 'create',
        changedBy: 'fixture',
        occurredAt: createdAt,
        newValue: ticketContext,
      },
    });
    const resolvedAudit = await prisma.auditLog.create({
      data: {
        entityType: 'ticket',
        entityId: BACKFILL_TICKET_ID,
        action: 'update',
        changedBy: 'fixture',
        occurredAt: resolvedAt,
        oldValue: ticketContext,
        newValue: {
          ...ticketContext,
          status: 'Resolved',
          updatedAt: resolvedAt.toISOString(),
        },
      },
    });
    const responseAudit = await prisma.auditLog.create({
      data: {
        entityType: 'note',
        entityId: 8_720_001,
        action: 'create',
        changedBy: 'fixture',
        occurredAt: respondedAt,
        newValue: {
          id: 8_720_001,
          ticketId: BACKFILL_TICKET_ID,
          noteType: 'email',
          direction: 'outbound',
          createdAt: respondedAt.toISOString(),
        },
      },
    });

    await expect(backfillTicketEvents()).resolves.toBe(3);
    const afterFirstRun = await prisma.ticketEvent.findMany({
      where: { ticketId: BACKFILL_TICKET_ID },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    expect(afterFirstRun).toHaveLength(3);
    expect(afterFirstRun.map((event) => event.kind)).toEqual([
      'created',
      'first_response',
      'resolved',
    ]);
    expect(afterFirstRun.every((event) => event.actor === 'backfill')).toBe(true);
    expect(new Set(afterFirstRun.map((event) => event.sourceAuditId))).toEqual(
      new Set([createdAudit.id, responseAudit.id, resolvedAudit.id]),
    );

    await expect(backfillTicketEvents()).resolves.toBe(0);
    const afterSecondRun = await prisma.ticketEvent.findMany({
      where: { ticketId: BACKFILL_TICKET_ID },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    expect(afterSecondRun).toEqual(afterFirstRun);
  });

  it('executes PostgreSQL percentile_cont for p50/p90 rather than a Node approximation', async () => {
    const createdAt = new Date('2037-02-01T00:00:00.000Z');
    const durations = [1, 2, 3, 100];
    await prisma.ticketEvent.createMany({
      data: durations.flatMap((minutes, index) => {
        const ticketId = DURATION_TICKET_BASE + index;
        const completedAt = new Date(createdAt.getTime() + minutes * 60_000);
        const dimensions = {
          companyId: 711,
          teamId: 712,
          assigneeId: 713,
          priority: 'High',
        };
        return [
          {
            ticketId,
            kind: 'created',
            toValue: 'New',
            actor: 'fixture',
            occurredAt: createdAt,
            sourceKey: `postgres-percentile:${ticketId}:created`,
            ...dimensions,
          },
          {
            ticketId,
            kind: 'first_response',
            toValue: 'responded',
            actor: 'fixture',
            occurredAt: completedAt,
            sourceKey: `postgres-percentile:${ticketId}:first-response`,
            ...dimensions,
          },
          {
            ticketId,
            kind: 'resolved',
            fromValue: 'In Progress',
            toValue: 'Resolved',
            actor: 'fixture',
            occurredAt: completedAt,
            sourceKey: `postgres-percentile:${ticketId}:resolved`,
            ...dimensions,
          },
        ];
      }),
    });

    const result = await durationPercentiles({
      from: createdAt,
      to: new Date('2037-02-02T00:00:00.000Z'),
      companyId: 711,
      teamId: 712,
      assigneeId: 713,
    });

    expect(result.data.firstResponse.count).toBe(4);
    expect(result.data.firstResponse.p50Minutes).toBeCloseTo(2.5, 10);
    expect(result.data.firstResponse.p90Minutes).toBeCloseTo(70.9, 10);
    expect(result.data.resolution.count).toBe(4);
    expect(result.data.resolution.p50Minutes).toBeCloseTo(2.5, 10);
    expect(result.data.resolution.p90Minutes).toBeCloseTo(70.9, 10);
  });

  it('executes every reporting aggregate against PostgreSQL', async () => {
    const filters = {
      from: new Date('2037-01-01T00:00:00.000Z'),
      to: new Date('2037-05-01T00:00:00.000Z'),
    };

    await expect(volumeByDay(filters)).resolves.toHaveProperty('data');
    await expect(slaCompliance(filters)).resolves.toHaveProperty('data');
    await expect(backlogAgeBuckets(filters)).resolves.toHaveProperty('data');
    await expect(throughputByAssignee(filters)).resolves.toHaveProperty('data');
    await expect(throughputByTeam(filters)).resolves.toHaveProperty('data');
    await expect(timeLoggedByCompany(filters)).resolves.toHaveProperty('data');
    await expect(
      metricContextAt(
        DURATION_TICKET_BASE,
        new Date('2037-02-01T00:01:00.000Z'),
      ),
    ).resolves.toMatchObject({ companyId: 711 });
  });

  it('keeps a frozen snapshot unchanged across policy edit and deletion', async () => {
    const responseDueAt = new Date('2037-03-01T11:00:00.000Z');
    const resolutionDueAt = new Date('2037-03-01T18:00:00.000Z');
    const policy = await prisma.slaPolicy.create({
      data: {
        name: 'Original promise',
        priority: 'High',
        responseMinutes: 60,
        resolutionMinutes: 480,
      },
    });
    const snapshot = await prisma.ticketSlaSnapshot.create({
      data: {
        ticketId: 8_730_001,
        policyId: policy.id,
        policyName: policy.name,
        responseMinutes: policy.responseMinutes,
        resolutionMinutes: policy.resolutionMinutes,
        responseDueAt,
        resolutionDueAt,
        establishedAt: new Date('2037-03-01T10:00:00.000Z'),
      },
    });

    await prisma.slaPolicy.update({
      where: { id: policy.id },
      data: {
        name: 'Edited policy',
        responseMinutes: 15,
        resolutionMinutes: 120,
      },
    });
    await prisma.slaPolicy.delete({ where: { id: policy.id } });

    await expect(
      prisma.ticketSlaSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } }),
    ).resolves.toEqual(snapshot);
  });

  it('enforces TicketEvent and TicketSlaSnapshot append-only behavior in PostgreSQL', async () => {
    const event = await prisma.ticketEvent.create({
      data: {
        ticketId: 8_740_001,
        kind: 'status_changed',
        fromValue: 'New',
        toValue: 'Assigned',
        actor: 'fixture',
        occurredAt: new Date('2037-04-01T10:00:00.000Z'),
        sourceKey: 'postgres-append-only:event',
      },
    });
    const snapshot = await prisma.ticketSlaSnapshot.create({
      data: {
        ticketId: 8_740_001,
        policyId: 123_456,
        policyName: 'Frozen fixture',
        responseMinutes: 30,
        resolutionMinutes: 240,
        responseDueAt: new Date('2037-04-01T10:30:00.000Z'),
        resolutionDueAt: new Date('2037-04-01T14:00:00.000Z'),
        establishedAt: new Date('2037-04-01T10:00:00.000Z'),
      },
    });

    await expect(
      prisma.ticketEvent.update({
        where: { id: event.id },
        data: { actor: 'tampered' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.ticketEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.ticketSlaSnapshot.update({
        where: { id: snapshot.id },
        data: { responseMinutes: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.ticketSlaSnapshot.delete({ where: { id: snapshot.id } }),
    ).rejects.toThrow();

    await expect(
      prisma.ticketEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).resolves.toEqual(event);
    await expect(
      prisma.ticketSlaSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } }),
    ).resolves.toEqual(snapshot);
  });
});
