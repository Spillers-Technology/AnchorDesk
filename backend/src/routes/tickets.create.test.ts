import Fastify from 'fastify';
import * as ticketRepo from '../repositories/ticketRepository';
import { ticketRoutes } from './tickets';

jest.mock('../repositories/ticketRepository', () => ({
  create: jest.fn(),
}));

const mockedTicketRepo = jest.mocked(ticketRepo);

async function technicianApp() {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.user = {
      id: 2,
      username: 'technician',
      displayName: 'Technician',
      email: null,
      role: 'technician',
      authProvider: 'local',
      themePref: null,
      kanbanColumns: null,
    };
    request.actorSub = 'technician';
    request.authChannel = 'web';
  });
  await app.register(ticketRoutes);
  await app.ready();
  return app;
}

describe('POST /tickets public create contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['source', 'jira'],
    ['ticketNumber', 'HELP-42'],
    ['externalId', 'HELP-42'],
    ['externalProvider', 'Jira production'],
    ['syncConnectionId', 7],
    ['syncState', 'synced'],
    ['remoteHash', 'attacker-controlled'],
    ['syncedAt', '2026-07-25T12:00:00.000Z'],
    ['remoteUpdatedAt', '2026-07-25T12:00:00.000Z'],
  ])('rejects server-owned provenance field %s before repository creation', async (field, value) => {
    const app = await technicianApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/tickets',
        payload: { title: 'Forged remote ticket', [field]: value },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain(field);
      expect(mockedTicketRepo.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('passes only legitimate fields and forces local provenance', async () => {
    const createdAt = new Date('2026-07-25T12:00:00.000Z');
    mockedTicketRepo.create.mockResolvedValue({
      id: 42,
      title: 'Printer offline',
      source: 'local',
      createdAt,
    } as never);
    const app = await technicianApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/tickets',
        payload: {
          title: 'Printer offline',
          summary: 'Front desk cannot print',
          description: 'The device shows as unavailable.',
          status: 'new',
          priority: 'high',
          companyName: 'Example Co',
          companyId: 3,
          contactId: 4,
          assignee: 'Technician',
          assigneeId: 2,
          teamId: 5,
          customFields: { location: 'Front desk' },
          dueAt: '2026-07-26T17:00:00.000Z',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(mockedTicketRepo.create).toHaveBeenCalledWith(
        {
          title: 'Printer offline',
          summary: 'Front desk cannot print',
          description: 'The device shows as unavailable.',
          status: 'New',
          priority: 'High',
          companyName: 'Example Co',
          companyId: 3,
          contactId: 4,
          assignee: 'Technician',
          assigneeId: 2,
          teamId: 5,
          customFields: { location: 'Front desk' },
          dueAt: new Date('2026-07-26T17:00:00.000Z'),
          source: 'local',
        },
        'technician'
      );
    } finally {
      await app.close();
    }
  });
});
