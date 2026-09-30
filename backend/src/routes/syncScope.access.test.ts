import Fastify from 'fastify';
import * as bypass from '../services/syncBypassService';
import * as syncOut from '../services/syncOutService';
import * as queries from '../services/syncScopeQueries';
import { syncScopeRoutes } from './syncScope';

jest.mock('../services/syncBypassService', () => {
  const actual = jest.requireActual('../services/syncBypassService');
  return {
    BypassError: actual.BypassError,
    request: jest.fn(),
    decide: jest.fn(),
    unpin: jest.fn(),
    scopeForTicket: jest.fn().mockResolvedValue({ job: null, detached: false, detachReason: null, detachedAt: null, pinned: false, requests: [] }),
    listQueue: jest.fn().mockResolvedValue([]),
  };
});
jest.mock('../services/syncOutService', () => {
  const actual = jest.requireActual('../services/syncOutService');
  return { SyncOutError: actual.SyncOutError, listDestinations: jest.fn().mockResolvedValue([]), sendToPsa: jest.fn() };
});
jest.mock('../services/syncScopeQueries', () => ({ searchPeople: jest.fn(), previewJob: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  requireRole: (...roles: string[]) => async (request: { user?: { role?: string } }, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) => {
    if (!request.user || !roles.includes(String(request.user.role))) {
      return reply.status(request.user ? 403 : 401).send({ error: 'forbidden' });
    }
  },
}));

async function appFor(role: 'admin' | 'technician') {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.user = {
      id: role === 'admin' ? 1 : 2,
      username: role,
      displayName: role,
      email: null,
      role,
      authProvider: 'local',
      themePref: null,
      kanbanColumns: null,
    };
    request.actorSub = role;
    request.authChannel = 'web';
  });
  await app.register(syncScopeRoutes);
  await app.ready();
  return app;
}

describe('sync scope routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lets a technician send a ticket and ask for a bypass, but not decide one', async () => {
    const tech = await appFor('technician');
    try {
      jest.mocked(syncOut.sendToPsa).mockResolvedValue({ ticketId: 5, externalId: 'HELP-1', provider: 'jira', jobName: 'J', warnings: [] });
      jest.mocked(bypass.request).mockResolvedValue({ id: 1 } as never);

      expect((await tech.inject({ method: 'GET', url: '/sync/destinations' })).statusCode).toBe(200);
      expect((await tech.inject({ method: 'GET', url: '/tickets/5/sync-scope' })).statusCode).toBe(200);
      expect((await tech.inject({ method: 'POST', url: '/tickets/5/sync-out', payload: { jobId: 3 } })).statusCode).toBe(200);
      expect(syncOut.sendToPsa).toHaveBeenCalledWith(5, 3, 'technician');

      expect((await tech.inject({ method: 'POST', url: '/tickets/5/sync-bypass', payload: { reason: 'VIP client' } })).statusCode).toBe(201);
      expect(bypass.request).toHaveBeenCalledWith(5, 'VIP client', { actor: 'technician', userId: 2, isAdmin: false });

      expect((await tech.inject({ method: 'POST', url: '/sync/bypass-requests/1/approve' })).statusCode).toBe(403);
      expect((await tech.inject({ method: 'GET', url: '/sync/bypass-requests' })).statusCode).toBe(403);
      expect((await tech.inject({ method: 'DELETE', url: '/tickets/5/sync-bypass' })).statusCode).toBe(403);
      expect((await tech.inject({ method: 'GET', url: '/sync/people?type=jira&q=jo' })).statusCode).toBe(403);
      expect((await tech.inject({ method: 'POST', url: '/sync/preview', payload: { type: 'jira' } })).statusCode).toBe(403);
      expect(bypass.decide).not.toHaveBeenCalled();
    } finally {
      await tech.close();
    }
  });

  it('lets an admin approve or reject, passing the note through', async () => {
    const admin = await appFor('admin');
    try {
      jest.mocked(bypass.decide).mockResolvedValue({ id: 1, status: 'approved' } as never);
      const res = await admin.inject({ method: 'POST', url: '/sync/bypass-requests/1/approve', payload: { note: 'ok' } });
      expect(res.statusCode).toBe(200);
      expect(bypass.decide).toHaveBeenCalledWith(1, 'approved', { actor: 'admin', userId: 1, isAdmin: true }, 'ok');
      await admin.inject({ method: 'POST', url: '/sync/bypass-requests/1/reject' });
      expect(bypass.decide).toHaveBeenLastCalledWith(1, 'rejected', expect.anything(), undefined);
    } finally {
      await admin.close();
    }
  });

  it('turns service errors into their status codes', async () => {
    const tech = await appFor('technician');
    try {
      jest.mocked(bypass.request).mockRejectedValue(new bypass.BypassError('this ticket is still syncing', 409));
      const res = await tech.inject({ method: 'POST', url: '/tickets/5/sync-bypass', payload: { reason: 'x' } });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'this ticket is still syncing' });

      jest.mocked(syncOut.sendToPsa).mockRejectedValue(new syncOut.SyncOutError('Jira: project not found', 502));
      expect((await tech.inject({ method: 'POST', url: '/tickets/5/sync-out', payload: { jobId: 3 } })).statusCode).toBe(502);
    } finally {
      await tech.close();
    }
  });

  it('validates input before touching a service', async () => {
    const admin = await appFor('admin');
    try {
      expect((await admin.inject({ method: 'POST', url: '/tickets/5/sync-out', payload: { jobId: 'x' } })).statusCode).toBe(400);
      expect((await admin.inject({ method: 'POST', url: '/tickets/5/sync-bypass', payload: {} })).statusCode).toBe(400);
      expect((await admin.inject({ method: 'GET', url: '/sync/people?type=imap' })).statusCode).toBe(400);
      expect((await admin.inject({ method: 'POST', url: '/sync/preview', payload: { type: 'jira', config: [] } })).statusCode).toBe(400);
      expect(syncOut.sendToPsa).not.toHaveBeenCalled();
      expect(queries.previewJob).not.toHaveBeenCalled();
    } finally {
      await admin.close();
    }
  });
});
