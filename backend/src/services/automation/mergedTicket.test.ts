/**
 * A merge must not look like a resolution to the automation engine.
 *
 * Merging sets the source's status to `Closed`, which is indistinguishable from
 * a real close to every "when status becomes Closed" rule — so without a guard a
 * routine duplicate cleanup fires satisfaction surveys and closure notices at
 * customers about tickets that were never worked. The survivor raises its own
 * events; the tombstone must raise none.
 */

jest.mock('../../db/prisma', () => ({
  prisma: { ticket: { findUnique: jest.fn() } },
}));

jest.mock('../../repositories/automationRepository', () => ({
  listEnabledFor: jest.fn(),
  markRan: jest.fn(),
}));

jest.mock('../../repositories/ticketRepository', () => ({ update: jest.fn() }));
jest.mock('../../repositories/noteRepository', () => ({ create: jest.fn() }));
jest.mock('../../repositories/labelRepository', () => ({ applyToTicket: jest.fn() }));
jest.mock('../notificationService', () => ({ notifyUser: jest.fn() }));

import { prisma } from '../../db/prisma';
import * as automationRepo from '../../repositories/automationRepository';
import * as ticketRepo from '../../repositories/ticketRepository';
import { publish } from '../realtime/eventBus';
import { initAutomationService } from './automationService';

const db = prisma as unknown as { ticket: { findUnique: jest.Mock } };
const repo = automationRepo as unknown as { listEnabledFor: jest.Mock; markRan: jest.Mock };

const closeRule = {
  id: 1,
  name: 'Survey on close',
  conditions: [{ field: 'status', op: 'eq', value: 'Closed' }],
  actions: [{ type: 'note', value: 'How did we do?' }],
};

/** Let the fire-and-forget event handler settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeAll(() => {
  initAutomationService();
});

beforeEach(() => {
  jest.clearAllMocks();
  repo.listEnabledFor.mockResolvedValue([closeRule]);
});

describe('automation on a merged ticket', () => {
  it('runs the close rule for an ordinary closed ticket', async () => {
    db.ticket.findUnique.mockResolvedValue({
      id: 1,
      status: 'Closed',
      title: 'Printer down',
      mergedIntoId: null,
      labels: [],
    });

    publish({ type: 'ticket.updated', ticketId: 1, ticket: {}, actor: 'alice' });
    await settle();

    expect(repo.markRan).toHaveBeenCalledWith(closeRule.id);
  });

  it('runs nothing when that same ticket was closed by being merged away', async () => {
    db.ticket.findUnique.mockResolvedValue({
      id: 1,
      status: 'Closed',
      title: 'Printer down',
      mergedIntoId: 42,
      labels: [],
    });

    publish({ type: 'ticket.updated', ticketId: 1, ticket: {}, actor: 'alice' });
    await settle();

    expect(repo.markRan).not.toHaveBeenCalled();
    expect(ticketRepo.update).not.toHaveBeenCalled();
  });
});
