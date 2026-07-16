/**
 * The manual-deadline contract on ticketRepository.update():
 *  - a dueAt in the input is written through (set and clear)
 *  - the SLA recompute triggered by a priority/company change never touches
 *    dueAt, so a manual deadline survives those edits by construction
 */
jest.mock('../db/prisma', () => ({
  prisma: {
    ticket: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('./auditRepository', () => ({
  record: jest.fn(),
}));

jest.mock('../services/realtime/eventBus', () => ({
  publish: jest.fn(),
}));

jest.mock('../services/sla', () => ({
  computeSlaFields: jest.fn(),
  effectiveResolutionDueAt: jest.fn(),
}));

import { prisma } from '../db/prisma';
import { computeSlaFields } from '../services/sla';
import { update } from './ticketRepository';

const ticketFindUnique = prisma.ticket.findUnique as jest.Mock;
const ticketUpdate = prisma.ticket.update as jest.Mock;
const computeSla = computeSlaFields as jest.Mock;

const MANUAL_DUE = new Date('2026-07-18T09:00:00Z');

function existingTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    title: 'printer on fire',
    status: 'Open',
    priority: 'Medium',
    companyId: 7,
    companyName: 'Acme',
    customFields: null,
    createdAt: new Date('2026-07-15T08:00:00Z'),
    dueAt: MANUAL_DUE,
    slaPolicyId: 1,
    responseDueAt: new Date('2026-07-15T09:00:00Z'),
    resolutionDueAt: new Date('2026-07-15T16:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  ticketUpdate.mockImplementation(({ data }) => Promise.resolve({ ...existingTicket(), ...data }));
});

describe('ticketRepository.update dueAt handling', () => {
  it('writes a new manual deadline through to the row', async () => {
    ticketFindUnique.mockResolvedValue(existingTicket({ dueAt: null }));
    const next = new Date('2026-07-19T12:00:00Z');
    await update(42, { dueAt: next }, 'alice');
    expect(ticketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dueAt: next }) }),
    );
  });

  it('clears the deadline with null (falls back to SLA)', async () => {
    ticketFindUnique.mockResolvedValue(existingTicket());
    await update(42, { dueAt: null }, 'alice');
    expect(ticketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dueAt: null }) }),
    );
  });

  it('a priority change recomputes SLA fields but never rewrites dueAt', async () => {
    ticketFindUnique.mockResolvedValue(existingTicket());
    computeSla.mockResolvedValue({
      slaPolicyId: 2,
      responseDueAt: new Date('2026-07-15T08:30:00Z'),
      resolutionDueAt: new Date('2026-07-15T12:00:00Z'),
    });

    await update(42, { priority: 'High' }, 'alice');

    expect(computeSla).toHaveBeenCalledWith('High', 7, existingTicket().createdAt);
    const data = ticketUpdate.mock.calls[0][0].data;
    expect(data.slaPolicyId).toBe(2);
    expect(data.resolutionDueAt).toEqual(new Date('2026-07-15T12:00:00Z'));
    // dueAt was not part of the input, so the recompute must leave it alone.
    expect(data.dueAt).toBeUndefined();
  });

  it('no SLA recompute happens when only dueAt changes', async () => {
    ticketFindUnique.mockResolvedValue(existingTicket());
    await update(42, { dueAt: new Date('2026-07-21T09:00:00Z') }, 'alice');
    expect(computeSla).not.toHaveBeenCalled();
  });
});
