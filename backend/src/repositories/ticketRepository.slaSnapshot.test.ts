jest.mock('../db/prisma', () => {
  const ticketSlaSnapshot = {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const ticket = {
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  };
  const slaPolicy = {
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const client = {
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
    ticket,
    ticketSlaSnapshot,
    slaPolicy,
  };
  client.$transaction.mockImplementation(
    async (callback: (tx: typeof client) => unknown) => callback(client),
  );
  return { prisma: client };
});

jest.mock('./auditRepository', () => ({
  record: jest.fn().mockResolvedValue({ id: 900n }),
}));

jest.mock('../services/realtime/eventBus', () => ({ publish: jest.fn() }));

jest.mock('../services/sla', () => ({
  computeSlaFields: jest.fn(),
  effectiveResolutionDueAt: jest.fn(),
}));

import { prisma } from '../db/prisma';
import { computeSlaFields } from '../services/sla';
import * as slaPolicies from './slaPolicyRepository';
import { update as updateTicket } from './ticketRepository';

const db = prisma as unknown as {
  ticket: {
    findUnique: jest.Mock;
    update: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  ticketSlaSnapshot: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  slaPolicy: {
    findUniqueOrThrow: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
};

const computeSla = computeSlaFields as jest.Mock;

describe('frozen TicketSlaSnapshot history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('survives policy edit/delete and appends rather than mutates on priority retarget', async () => {
    const established = new Date('2026-07-01T09:00:00Z');
    const frozen = {
      id: 10n,
      ticketId: 42,
      policyId: 1,
      policyName: 'Standard',
      responseMinutes: 60,
      resolutionMinutes: 480,
      responseDueAt: new Date('2026-07-01T10:00:00Z'),
      resolutionDueAt: new Date('2026-07-01T17:00:00Z'),
      establishedAt: established,
    };
    const frozenBefore = { ...frozen };

    db.slaPolicy.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      name: 'Standard',
      responseMinutes: 60,
      resolutionMinutes: 480,
    });
    db.slaPolicy.update.mockResolvedValue({
      id: 1,
      name: 'Standard edited',
      responseMinutes: 30,
      resolutionMinutes: 240,
    });
    db.slaPolicy.delete.mockResolvedValue({ id: 1, name: 'Standard edited' });

    await slaPolicies.update(1, { responseMinutes: 30 }, 'admin');
    expect(frozen).toEqual(frozenBefore);
    expect(db.ticketSlaSnapshot.update).not.toHaveBeenCalled();

    await slaPolicies.remove(1, 'admin');
    expect(frozen).toEqual(frozenBefore);
    expect(db.ticketSlaSnapshot.delete).not.toHaveBeenCalled();

    const beforeTicket = {
      id: 42,
      title: 'SLA test',
      status: 'New',
      priority: 'Medium',
      companyId: 7,
      companyName: 'Acme',
      contactId: null,
      assignee: null,
      assigneeId: null,
      teamId: null,
      customFields: null,
      createdAt: established,
      updatedAt: established,
      externalId: null,
      externalProvider: null,
      syncState: null,
    };
    const retargetedAt = new Date('2026-07-02T09:00:00Z');
    const afterTicket = {
      ...beforeTicket,
      priority: 'High',
      slaPolicyId: 2,
      responseDueAt: new Date('2026-07-01T09:30:00Z'),
      resolutionDueAt: new Date('2026-07-01T13:00:00Z'),
      updatedAt: retargetedAt,
    };
    db.ticket.findUnique.mockResolvedValue(beforeTicket);
    db.ticket.update.mockResolvedValue(afterTicket);
    db.ticket.findUniqueOrThrow.mockResolvedValue(afterTicket);
    db.ticketSlaSnapshot.findFirst.mockResolvedValue(frozen);
    db.ticketSlaSnapshot.create.mockImplementation(async ({ data }) => ({ id: 11n, ...data }));
    computeSla.mockResolvedValue({
      slaPolicyId: 2,
      responseDueAt: afterTicket.responseDueAt,
      resolutionDueAt: afterTicket.resolutionDueAt,
      snapshot: {
        policyId: 2,
        policyName: 'Urgent',
        responseMinutes: 30,
        resolutionMinutes: 240,
        responseDueAt: afterTicket.responseDueAt,
        resolutionDueAt: afterTicket.resolutionDueAt,
      },
    });

    await updateTicket(42, { priority: 'High' }, 'alice');

    expect(frozen).toEqual(frozenBefore);
    expect(db.ticketSlaSnapshot.update).not.toHaveBeenCalled();
    expect(db.ticketSlaSnapshot.delete).not.toHaveBeenCalled();
    expect(db.ticketSlaSnapshot.create).toHaveBeenCalledTimes(1);
    expect(db.ticketSlaSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: 42,
        policyId: 2,
        policyName: 'Urgent',
        responseMinutes: 30,
        resolutionMinutes: 240,
        establishedAt: retargetedAt,
      }),
    });
  });

  it('does not establish a fresh promise when a terminal ticket is merely reprioritized', async () => {
    const established = new Date('2026-07-01T09:00:00Z');
    const beforeTicket = {
      id: 42,
      title: 'Completed SLA test',
      status: 'Resolved',
      priority: 'Medium',
      companyId: 7,
      companyName: 'Acme',
      contactId: null,
      assignee: null,
      assigneeId: null,
      teamId: null,
      customFields: null,
      createdAt: established,
      updatedAt: established,
      externalId: null,
      externalProvider: null,
      syncState: null,
    };
    const afterTicket = {
      ...beforeTicket,
      priority: 'High',
      updatedAt: new Date('2026-07-02T09:00:00Z'),
    };
    db.ticket.findUnique.mockResolvedValue(beforeTicket);
    db.ticket.update.mockResolvedValue(afterTicket);
    db.ticket.findUniqueOrThrow.mockResolvedValue(afterTicket);
    computeSla.mockResolvedValue({
      slaPolicyId: 2,
      responseDueAt: new Date('2026-07-01T09:30:00Z'),
      resolutionDueAt: new Date('2026-07-01T13:00:00Z'),
      snapshot: {
        policyId: 2,
        policyName: 'Urgent',
        responseMinutes: 30,
        resolutionMinutes: 240,
        responseDueAt: new Date('2026-07-01T09:30:00Z'),
        resolutionDueAt: new Date('2026-07-01T13:00:00Z'),
      },
    });

    await updateTicket(42, { priority: 'High' }, 'alice');

    expect(db.ticketSlaSnapshot.findFirst).not.toHaveBeenCalled();
    expect(db.ticketSlaSnapshot.create).not.toHaveBeenCalled();
  });

  it('establishes the terminal reprioritization target when the ticket is later reopened', async () => {
    const established = new Date('2026-07-01T09:00:00Z');
    const reprioritizedAt = new Date('2026-07-02T09:00:00Z');
    const reopenedAt = new Date('2026-07-03T09:00:00Z');
    const frozen = {
      id: 10n,
      ticketId: 42,
      policyId: 1,
      policyName: 'Standard',
      responseMinutes: 60,
      resolutionMinutes: 480,
      responseDueAt: new Date('2026-07-01T10:00:00Z'),
      resolutionDueAt: new Date('2026-07-01T17:00:00Z'),
      establishedAt: established,
    };
    const urgentTarget = {
      policyId: 2,
      policyName: 'Urgent',
      responseMinutes: 30,
      resolutionMinutes: 240,
      responseDueAt: new Date('2026-07-01T09:30:00Z'),
      resolutionDueAt: new Date('2026-07-01T13:00:00Z'),
    };
    const resolved = {
      id: 42,
      title: 'Reopen SLA test',
      status: 'Resolved',
      priority: 'Medium',
      companyId: 7,
      companyName: 'Acme',
      contactId: null,
      assignee: null,
      assigneeId: null,
      teamId: null,
      customFields: null,
      slaPolicyId: 1,
      responseDueAt: frozen.responseDueAt,
      resolutionDueAt: frozen.resolutionDueAt,
      createdAt: established,
      updatedAt: established,
      externalId: null,
      externalProvider: null,
      syncState: null,
    };
    const reprioritized = {
      ...resolved,
      priority: 'High',
      slaPolicyId: 2,
      responseDueAt: urgentTarget.responseDueAt,
      resolutionDueAt: urgentTarget.resolutionDueAt,
      updatedAt: reprioritizedAt,
    };
    const reopened = {
      ...reprioritized,
      status: 'In Progress',
      updatedAt: reopenedAt,
    };

    db.ticket.findUnique
      .mockResolvedValueOnce(resolved)
      .mockResolvedValueOnce(reprioritized);
    db.ticket.update
      .mockResolvedValueOnce(reprioritized)
      .mockResolvedValueOnce(reopened);
    db.ticket.findUniqueOrThrow
      .mockResolvedValueOnce(reprioritized)
      .mockResolvedValueOnce(reopened);
    db.ticketSlaSnapshot.findFirst.mockResolvedValue(frozen);
    db.ticketSlaSnapshot.create.mockImplementation(async ({ data }) => ({ id: 11n, ...data }));
    computeSla.mockResolvedValue({
      slaPolicyId: 2,
      responseDueAt: urgentTarget.responseDueAt,
      resolutionDueAt: urgentTarget.resolutionDueAt,
      snapshot: urgentTarget,
    });

    await updateTicket(42, { priority: 'High' }, 'alice');
    expect(db.ticketSlaSnapshot.create).not.toHaveBeenCalled();

    await updateTicket(42, { status: 'In Progress' }, 'alice');

    expect(computeSla).toHaveBeenCalledTimes(2);
    expect(computeSla).toHaveBeenLastCalledWith('High', 7, established);
    expect(db.ticketSlaSnapshot.create).toHaveBeenCalledTimes(1);
    expect(db.ticketSlaSnapshot.create).toHaveBeenCalledWith({
      data: {
        ticketId: 42,
        ...urgentTarget,
        establishedAt: reopenedAt,
      },
    });
  });

  it('treats companyId null as a real clear and appends the replacement target', async () => {
    const established = new Date('2026-07-01T09:00:00Z');
    const clearedAt = new Date('2026-07-02T09:00:00Z');
    const companyTarget = {
      id: 10n,
      ticketId: 42,
      policyId: 1,
      policyName: 'Acme standard',
      responseMinutes: 60,
      resolutionMinutes: 480,
      responseDueAt: new Date('2026-07-01T10:00:00Z'),
      resolutionDueAt: new Date('2026-07-01T17:00:00Z'),
      establishedAt: established,
    };
    const globalTarget = {
      policyId: 3,
      policyName: 'Global standard',
      responseMinutes: 120,
      resolutionMinutes: 960,
      responseDueAt: new Date('2026-07-01T11:00:00Z'),
      resolutionDueAt: new Date('2026-07-02T01:00:00Z'),
    };
    const before = {
      id: 42,
      title: 'Company clear SLA test',
      status: 'In Progress',
      priority: 'Medium',
      companyId: 7,
      companyName: 'Acme',
      contactId: null,
      assignee: null,
      assigneeId: null,
      teamId: null,
      customFields: null,
      slaPolicyId: 1,
      responseDueAt: companyTarget.responseDueAt,
      resolutionDueAt: companyTarget.resolutionDueAt,
      createdAt: established,
      updatedAt: established,
      externalId: null,
      externalProvider: null,
      syncState: null,
    };
    const after = {
      ...before,
      companyId: null,
      slaPolicyId: 3,
      responseDueAt: globalTarget.responseDueAt,
      resolutionDueAt: globalTarget.resolutionDueAt,
      updatedAt: clearedAt,
    };
    db.ticket.findUnique.mockResolvedValue(before);
    db.ticket.update.mockResolvedValue(after);
    db.ticket.findUniqueOrThrow.mockResolvedValue(after);
    db.ticketSlaSnapshot.findFirst.mockResolvedValue(companyTarget);
    db.ticketSlaSnapshot.create.mockImplementation(async ({ data }) => ({ id: 11n, ...data }));
    computeSla.mockResolvedValue({
      slaPolicyId: 3,
      responseDueAt: globalTarget.responseDueAt,
      resolutionDueAt: globalTarget.resolutionDueAt,
      snapshot: globalTarget,
    });

    await updateTicket(42, { companyId: null }, 'admin');

    expect(computeSla).toHaveBeenCalledWith('Medium', null, established);
    expect(db.ticket.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: expect.objectContaining({
        companyId: null,
        slaPolicyId: 3,
        responseDueAt: globalTarget.responseDueAt,
        resolutionDueAt: globalTarget.resolutionDueAt,
      }),
    });
    expect(db.ticketSlaSnapshot.create).toHaveBeenCalledWith({
      data: {
        ticketId: 42,
        ...globalTarget,
        establishedAt: clearedAt,
      },
    });
  });
});
