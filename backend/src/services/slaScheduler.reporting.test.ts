jest.mock('../db/prisma', () => ({
  prisma: {
    ticket: { findMany: jest.fn() },
    ticketSlaSnapshot: { findMany: jest.fn() },
  },
}));

jest.mock('../repositories/ticketEventRepository', () => ({
  metricContextAt: jest.fn(),
}));

jest.mock('./realtime/eventBus', () => ({
  publish: jest.fn(),
}));

import { prisma } from '../db/prisma';
import * as ticketEvents from '../repositories/ticketEventRepository';
import { publish } from './realtime/eventBus';
import { startSlaScheduler, stopSlaScheduler } from './slaScheduler';

const ticketFindMany = prisma.ticket.findMany as jest.Mock;
const snapshotFindMany = prisma.ticketSlaSnapshot.findMany as jest.Mock;
const metricContextAt = ticketEvents.metricContextAt as jest.Mock;
const publishEvent = publish as jest.Mock;

afterEach(() => {
  stopSlaScheduler();
  jest.useRealTimers();
  jest.clearAllMocks();
});

it('records an SLA breach at the due instant with dimensions from that instant', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-07-20T12:01:00Z'));
  const dueAt = new Date('2026-07-20T12:00:00Z');
  ticketFindMany.mockResolvedValue([{
    id: 9042,
    companyId: 99,
    teamId: 98,
    assigneeId: 97,
    priority: 'High',
    status: 'In Progress',
    createdAt: new Date('2026-07-20T10:00:00Z'),
    firstRespondedAt: null,
    responseDueAt: dueAt,
    resolutionDueAt: null,
    dueAt: null,
  }]);
  snapshotFindMany.mockResolvedValue([{
    id: 55n,
    ticketId: 9042,
    establishedAt: new Date('2026-07-20T10:00:00Z'),
    responseDueAt: dueAt,
    resolutionDueAt: null,
  }]);
  metricContextAt.mockResolvedValue({
    companyId: 7,
    teamId: 8,
    assigneeId: 9,
    priority: 'Medium',
    status: 'In Progress',
    occurredAt: dueAt,
  });
  const log = { info: jest.fn(), error: jest.fn() };

  startSlaScheduler(log as never);
  await jest.advanceTimersByTimeAsync(60_000);

  expect(metricContextAt).toHaveBeenCalledWith(9042, dueAt);
  expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({
    type: 'sla.atRisk',
    ticketId: 9042,
    kind: 'response',
    level: 'breached',
    dueAt,
    targetIdentity: 'snapshot:55',
    metricContext: {
      companyId: 7,
      teamId: 8,
      assigneeId: 9,
      priority: 'Medium',
      status: 'In Progress',
      occurredAt: dueAt,
    },
  }));
});

it('records an already-overdue re-target when the new promise was established', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-07-21T12:00:00Z'));
  const dueAt = new Date('2026-07-18T12:00:00Z');
  const establishedAt = new Date('2026-07-20T09:00:00Z');
  ticketFindMany.mockResolvedValue([{
    id: 9043,
    companyId: 7,
    teamId: 8,
    assigneeId: 9,
    priority: 'High',
    status: 'In Progress',
    createdAt: new Date('2026-07-17T12:00:00Z'),
    firstRespondedAt: null,
    responseDueAt: dueAt,
    resolutionDueAt: null,
    dueAt: null,
  }]);
  snapshotFindMany.mockResolvedValue([{
    id: 56n,
    ticketId: 9043,
    establishedAt,
    responseDueAt: dueAt,
    resolutionDueAt: null,
  }]);
  metricContextAt.mockResolvedValue({
    companyId: 7,
    teamId: 8,
    assigneeId: 9,
    priority: 'High',
    status: 'In Progress',
    occurredAt: establishedAt,
  });

  startSlaScheduler({ info: jest.fn(), error: jest.fn() } as never);
  await jest.advanceTimersByTimeAsync(60_000);

  expect(metricContextAt).toHaveBeenCalledWith(9043, establishedAt);
  expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({
    ticketId: 9043,
    dueAt,
    metricContext: expect.objectContaining({ occurredAt: establishedAt }),
  }));
});
