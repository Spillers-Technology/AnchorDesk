jest.mock('../db/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    ticket: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    ticketSlaSnapshot: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    ticketEvent: {
      createMany: jest.fn(),
    },
  },
}));

jest.mock('./auditRepository', () => ({
  record: jest.fn().mockResolvedValue({ id: 501n }),
}));

jest.mock('../services/realtime/eventBus', () => ({
  publish: jest.fn(),
}));

jest.mock('../services/sla', () => ({
  computeSlaFields: jest.fn(),
  effectiveResolutionDueAt: jest.fn(),
}));

import { prisma } from '../db/prisma';
import { publish } from '../services/realtime/eventBus';
import { factsForDomainEvent } from '../services/realtime/ticketEventSubscriber';
import { update } from './ticketRepository';

const transaction = prisma.$transaction as jest.Mock;
const findUnique = prisma.ticket.findUnique as jest.Mock;
const ticketUpdate = prisma.ticket.update as jest.Mock;
const findUniqueOrThrow = prisma.ticket.findUniqueOrThrow as jest.Mock;
const publishEvent = publish as jest.Mock;

function ticket(status = 'In Progress') {
  return {
    id: 42,
    title: 'Event test',
    status,
    priority: 'Medium',
    companyId: 7,
    companyName: 'Acme',
    contactId: null,
    assignee: null,
    assigneeId: null,
    teamId: null,
    customFields: null,
    createdAt: new Date('2026-07-01T09:00:00Z'),
    updatedAt: new Date('2026-07-18T09:00:00Z'),
    externalId: null,
    externalProvider: null,
    syncState: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
  );
});

describe('ticketRepository status fact emission', () => {
  it('a same-status no-op emits no status_changed fact', async () => {
    const before = ticket();
    const after = { ...before, updatedAt: new Date('2026-07-18T09:01:00Z') };
    findUnique.mockResolvedValue(before);
    ticketUpdate.mockResolvedValue(after);
    findUniqueOrThrow.mockResolvedValue(after);

    await update(42, { status: 'In Progress' }, 'alice');

    const event = publishEvent.mock.calls[0][0];
    expect(event.metric.status).toBeUndefined();
    expect(factsForDomainEvent(event)).toEqual([]);
  });

  it('one real transition becomes exactly one resolved fact', async () => {
    const before = ticket('In Progress');
    const after = {
      ...before,
      status: 'Resolved',
      updatedAt: new Date('2026-07-18T09:01:00Z'),
    };
    findUnique.mockResolvedValue(before);
    ticketUpdate.mockResolvedValue(after);
    findUniqueOrThrow.mockResolvedValue(after);

    await update(42, { status: 'Resolved' }, 'alice');

    const facts = factsForDomainEvent(publishEvent.mock.calls[0][0]);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      ticketId: 42,
      kind: 'resolved',
      fromValue: 'In Progress',
      toValue: 'Resolved',
      sourceAuditId: '501',
    });
  });
});
