jest.mock('../db/prisma', () => ({
  prisma: {
    company: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
    team: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    ticket: {
      findMany: jest.fn(),
    },
    device: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('./auditRepository', () => ({
  record: jest.fn().mockResolvedValue({ id: 1n }),
}));

jest.mock('./ticketRepository', () => ({
  update: jest.fn(),
}));

import { prisma } from '../db/prisma';
import * as tickets from './ticketRepository';
import * as companies from './companyRepository';
import * as teams from './teamRepository';

const ticketFindMany = prisma.ticket.findMany as jest.Mock;
const ticketUpdate = tickets.update as jest.Mock;
const companyFindUnique = prisma.company.findUnique as jest.Mock;
const companyFindFirst = prisma.company.findFirst as jest.Mock;
const companyDelete = prisma.company.delete as jest.Mock;
const teamFindUnique = prisma.team.findUnique as jest.Mock;
const teamDelete = prisma.team.delete as jest.Mock;
const deviceFindMany = prisma.device.findMany as jest.Mock;
const deviceUpdateMany = prisma.device.updateMany as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  ticketUpdate.mockResolvedValue({ id: 1 });
  deviceFindMany.mockResolvedValue([]);
  deviceUpdateMany.mockResolvedValue({ count: 0 });
});

describe('ticket dimension mutations stay on the audited event path', () => {
  it('clears each ticket company through ticketRepository before company deletion', async () => {
    companyFindUnique.mockResolvedValue({ id: 7, name: 'Acme' });
    ticketFindMany.mockResolvedValue([{ id: 11 }, { id: 12 }]);
    companyDelete.mockResolvedValue({ id: 7 });

    await companies.remove(7, 'admin');

    expect(ticketUpdate).toHaveBeenNthCalledWith(
      1,
      11,
      { companyId: null },
      'admin',
      { expectedCompanyId: 7 },
    );
    expect(ticketUpdate).toHaveBeenNthCalledWith(
      2,
      12,
      { companyId: null },
      'admin',
      { expectedCompanyId: 7 },
    );
    expect(ticketUpdate.mock.invocationCallOrder[1]).toBeLessThan(
      companyDelete.mock.invocationCallOrder[0],
    );
  });

  it('clears each ticket team through ticketRepository before team deletion', async () => {
    teamFindUnique.mockResolvedValue({ id: 4, name: 'Escalations' });
    ticketFindMany.mockResolvedValue([{ id: 21 }]);
    teamDelete.mockResolvedValue({ id: 4 });

    await teams.remove(4, 'admin');

    expect(ticketUpdate).toHaveBeenCalledWith(
      21,
      { teamId: null },
      'admin',
      { expectedTeamId: 4 },
    );
    expect(ticketUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      teamDelete.mock.invocationCallOrder[0],
    );
  });

  it('links legacy ticket company names through the same transition path', async () => {
    ticketFindMany
      .mockResolvedValueOnce([{ companyName: 'Acme' }])
      .mockResolvedValueOnce([{ id: 31 }, { id: 32 }]);
    companyFindFirst.mockResolvedValue({ id: 7, name: 'Acme' });

    const result = await companies.backfillFromNames('admin');

    expect(ticketUpdate).toHaveBeenNthCalledWith(
      1,
      31,
      { companyId: 7 },
      'admin',
      { expectedCompanyId: null },
    );
    expect(ticketUpdate).toHaveBeenNthCalledWith(
      2,
      32,
      { companyId: 7 },
      'admin',
      { expectedCompanyId: null },
    );
    expect(result.tickets).toBe(2);
  });
});
