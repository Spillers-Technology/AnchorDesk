jest.mock('../db/prisma', () => ({
  prisma: {
    ticket: { findUnique: jest.fn() },
    ticketFeedback: { create: jest.fn(), findMany: jest.fn() },
  },
}));
jest.mock('./auditRepository', () => ({ record: jest.fn() }));

import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { create, listForTicket } from './ticketFeedbackRepository';

const db = prisma as unknown as {
  ticket: { findUnique: jest.Mock };
  ticketFeedback: { create: jest.Mock; findMany: jest.Mock };
};
const recordAudit = audit.record as jest.Mock;

describe('ticketFeedbackRepository', () => {
  beforeEach(() => jest.clearAllMocks());

  it('copies the ticket dimensions into a new immutable feedback row and audits it', async () => {
    db.ticket.findUnique.mockResolvedValue({ companyId: 3, teamId: 4, assigneeId: 5 });
    const row = {
      id: 9,
      ticketId: 42,
      rating: 'positive',
      comment: 'Thank you',
      contactId: 7,
      companyId: 3,
      teamId: 4,
      assigneeId: 5,
      submittedAt: new Date('2026-08-06T12:00:00.000Z'),
    };
    db.ticketFeedback.create.mockResolvedValue(row);

    await expect(create({ ticketId: 42, rating: 'positive', comment: 'Thank you', contactId: 7 }, 'requester:7 (portal)'))
      .resolves.toEqual(row);

    expect(db.ticket.findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: { companyId: true, teamId: true, assigneeId: true },
    });
    expect(db.ticketFeedback.create).toHaveBeenCalledWith({
      data: {
        ticketId: 42,
        rating: 'positive',
        comment: 'Thank you',
        contactId: 7,
        companyId: 3,
        teamId: 4,
        assigneeId: 5,
      },
    });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'ticket_feedback',
      entityId: 9,
      action: 'create',
      changedBy: 'requester:7 (portal)',
    }), prisma);
  });

  it('lists feedback oldest first with the submitting contact for staff reads', async () => {
    db.ticketFeedback.findMany.mockResolvedValue([{ id: 1 }]);
    await expect(listForTicket(42)).resolves.toEqual([{ id: 1 }]);
    expect(db.ticketFeedback.findMany).toHaveBeenCalledWith({
      where: { ticketId: 42 },
      orderBy: { submittedAt: 'asc' },
      select: expect.objectContaining({
        contact: { select: { id: true, name: true, email: true } },
      }),
    });
  });
});
