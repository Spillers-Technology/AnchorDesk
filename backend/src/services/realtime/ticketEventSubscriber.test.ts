jest.mock('../../db/prisma', () => ({
  prisma: {
    ticketEvent: {
      createMany: jest.fn(),
    },
  },
}));

import { prisma } from '../../db/prisma';
import {
  append,
  AppendTicketEvent,
  TicketEventKind,
} from '../../repositories/ticketEventRepository';
import { DomainEvent, TicketMetricContext, TicketMetricTransition } from './eventBus';
import { factsForDomainEvent } from './ticketEventSubscriber';

const createMany = prisma.ticketEvent.createMany as jest.Mock;
const OCCURRED_AT = new Date('2026-07-18T14:30:00.000Z');
const AUDIT_ID = '9223372036854775000';

function context(overrides: Partial<TicketMetricContext> = {}): TicketMetricContext {
  return {
    companyId: 7,
    teamId: 8,
    assigneeId: 9,
    priority: 'High',
    status: 'In Progress',
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

function updated(metric?: TicketMetricTransition): DomainEvent {
  return {
    type: 'ticket.updated',
    ticketId: 42,
    ticket: {},
    actor: 'alice',
    auditId: AUDIT_ID,
    ...(metric ? { metric } : {}),
  };
}

const statusFactKinds = new Set<TicketEventKind>([
  'status_changed',
  'resolved',
  'reopened',
]);

describe('ticket metric fact classification', () => {
  it('emits no fact for an update without metric transition data', () => {
    expect(factsForDomainEvent(updated())).toEqual([]);
  });

  it('emits no status fact when status did not change, while preserving another real fact', () => {
    const facts = factsForDomainEvent(updated({
      context: context(),
      status: { from: 'In Progress', to: 'In Progress' },
      assignment: {
        fromAssigneeId: 3,
        toAssigneeId: 9,
        fromTeamId: 8,
        toTeamId: 8,
      },
    }));

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ kind: 'assigned' });
    expect(facts.filter((fact) => statusFactKinds.has(fact.kind))).toEqual([]);
  });

  it.each([
    ['Assigned', 'In Progress', 'status_changed'],
    ['Waiting', 'Resolved', 'resolved'],
    ['Closed', 'Assigned', 'reopened'],
  ] as const)(
    'classifies %s -> %s as exactly one %s fact',
    (from, to, kind) => {
      const facts = factsForDomainEvent(updated({
        context: context({ status: to }),
        status: { from, to },
      }));

      expect(facts).toHaveLength(1);
      expect(facts[0]).toEqual(expect.objectContaining({
        ticketId: 42,
        kind,
        fromValue: from,
        toValue: to,
        sourceAuditId: AUDIT_ID,
      }));
      expect(facts.filter((fact) => statusFactKinds.has(fact.kind))).toHaveLength(1);
    },
  );

  it('records only the merge-source fact when a merge event carries other changed fields', () => {
    const facts = factsForDomainEvent(updated({
      context: context({ status: 'Closed' }),
      merge: { targetId: 77, fromStatus: 'In Progress' },
      status: { from: 'In Progress', to: 'Closed' },
      assignment: {
        fromAssigneeId: 9,
        toAssigneeId: 11,
        fromTeamId: 8,
        toTeamId: 12,
      },
      contextChanged: true,
    }));

    expect(facts).toEqual([
      expect.objectContaining({
        ticketId: 42,
        kind: 'merged',
        fromValue: 'In Progress',
        toValue: '77',
        sourceAuditId: AUDIT_ID,
      }),
    ]);
  });

  it.each([
    {
      label: 'the first-response stamp was not won',
      firstResponseRecorded: false,
      metricContext: context(),
    },
    {
      label: 'metric context is absent',
      firstResponseRecorded: true,
      metricContext: undefined,
    },
  ])('does not invent a first-response fact when $label', ({
    firstResponseRecorded,
    metricContext,
  }) => {
    const event: DomainEvent = {
      type: 'note.added',
      ticketId: 42,
      note: {},
      actor: 'alice',
      auditId: AUDIT_ID,
      firstResponseRecorded,
      ...(metricContext ? { metricContext } : {}),
    };

    expect(factsForDomainEvent(event)).toEqual([]);
  });

  it('records first response only when the atomic first-response stamp succeeded', () => {
    const facts = factsForDomainEvent({
      type: 'note.added',
      ticketId: 42,
      note: {},
      actor: 'alice',
      auditId: AUDIT_ID,
      firstResponseRecorded: true,
      metricContext: context(),
    });

    expect(facts).toEqual([
      expect.objectContaining({
        ticketId: 42,
        kind: 'first_response',
        fromValue: null,
        toValue: 'responded',
        sourceAuditId: AUDIT_ID,
      }),
    ]);
  });

  it('gives repeated SLA breach delivery one deterministic source identity', () => {
    const dueAt = new Date('2026-07-18T15:00:00.000Z');
    const event: DomainEvent = {
      type: 'sla.atRisk',
      ticketId: 42,
      level: 'breached',
      kind: 'response',
      dueAt,
      targetSource: 'sla',
      metricContext: context(),
    };

    const first = factsForDomainEvent(event);
    const retry = factsForDomainEvent(event);

    expect(retry).toEqual(first);
    expect(first).toEqual([
      expect.objectContaining({
        ticketId: 42,
        kind: 'sla_breached',
        fromValue: 'response',
        toValue: dueAt.toISOString(),
        actor: 'sla_scheduler',
        occurredAt: OCCURRED_AT,
        sourceKey: `sla:42:response:${dueAt.toISOString()}`,
      }),
    ]);
  });

  it('keeps distinct frozen targets distinct when their deadlines are equal', () => {
    const dueAt = new Date('2026-07-18T15:00:00.000Z');
    const event = (targetIdentity: string): DomainEvent => ({
      type: 'sla.atRisk',
      ticketId: 42,
      level: 'breached',
      kind: 'response',
      dueAt,
      targetSource: 'sla',
      targetIdentity,
      metricContext: context(),
    });

    const first = factsForDomainEvent(event('snapshot:10'))[0];
    const retarget = factsForDomainEvent(event('snapshot:11'))[0];

    expect(first.sourceKey).toBe('sla:42:response:snapshot:10');
    expect(retarget.sourceKey).toBe('sla:42:response:snapshot:11');
  });

  it.each([
    { level: 'warning' as const, targetSource: 'sla' as const, dueAt: new Date() },
    { level: 'breached' as const, targetSource: 'manual' as const, dueAt: new Date() },
    { level: 'breached' as const, targetSource: 'sla' as const, dueAt: undefined },
  ])('does not record an SLA fact for an ineligible scheduler event %#', (variant) => {
    expect(factsForDomainEvent({
      type: 'sla.atRisk',
      ticketId: 42,
      kind: 'resolution',
      metricContext: context(),
      ...variant,
    })).toEqual([]);
  });
});

describe('ticket event append boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses createMany duplicate skipping and preserves both source identity forms', async () => {
    createMany.mockResolvedValue({ count: 2 });
    const auditFact: AppendTicketEvent = {
      ticketId: 42,
      kind: 'resolved',
      fromValue: 'In Progress',
      toValue: 'Resolved',
      actor: 'alice',
      companyId: 7,
      teamId: 8,
      assigneeId: 9,
      priority: 'High',
      occurredAt: OCCURRED_AT,
      sourceAuditId: AUDIT_ID,
    };
    const slaFact: AppendTicketEvent = {
      ticketId: 42,
      kind: 'sla_breached',
      occurredAt: OCCURRED_AT,
      sourceKey: 'sla:42:response:2026-07-18T15:00:00.000Z',
    };

    await expect(append([auditFact, slaFact])).resolves.toBe(2);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          ticketId: 42,
          kind: 'resolved',
          fromValue: 'In Progress',
          toValue: 'Resolved',
          actor: 'alice',
          companyId: 7,
          teamId: 8,
          assigneeId: 9,
          priority: 'High',
          occurredAt: OCCURRED_AT,
          sourceAuditId: BigInt(AUDIT_ID),
          sourceKey: null,
        },
        {
          ticketId: 42,
          kind: 'sla_breached',
          fromValue: null,
          toValue: null,
          actor: null,
          companyId: null,
          teamId: null,
          assigneeId: null,
          priority: null,
          occurredAt: OCCURRED_AT,
          sourceAuditId: null,
          sourceKey: 'sla:42:response:2026-07-18T15:00:00.000Z',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('does not issue a database write for an empty fact batch', async () => {
    await expect(append([])).resolves.toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });
});
