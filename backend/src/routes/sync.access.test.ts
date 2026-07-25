import Fastify from 'fastify';
import * as syncProviderRepo from '../repositories/syncProviderRepository';
import * as syncRunRepo from '../repositories/syncRunRepository';
import { runSync } from '../services/syncService';
import { syncRoutes } from './sync';

jest.mock('../repositories/syncProviderRepository', () => {
  const actual = jest.requireActual('../repositories/syncProviderRepository');
  return {
    ...actual,
    list: jest.fn(),
    getByName: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
});
jest.mock('../services/syncService', () => ({
  runSync: jest.fn(),
  runAllSync: jest.fn(),
  isSyncActive: jest.fn().mockReturnValue(false),
  SyncAlreadyRunningError: jest.requireActual('../services/syncService').SyncAlreadyRunningError,
  SyncRunFinalizationError: jest.requireActual('../services/syncService').SyncRunFinalizationError,
}));
jest.mock('../repositories/syncRunRepository', () => {
  const actual = jest.requireActual('../repositories/syncRunRepository');
  return {
    ...actual,
    healthForProviders: jest.fn().mockResolvedValue(new Map()),
    list: jest.fn().mockResolvedValue([]),
    getWithLogs: jest.fn(),
  };
});
jest.mock('../db/prisma', () => ({ prisma: { syncLog: { findMany: jest.fn().mockResolvedValue([]) } } }));
jest.mock('../middleware/auth', () => ({
  requireRole: (...roles: string[]) => async (request: { user?: { role?: string } }, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) => {
    if (!request.user || !roles.includes(String(request.user.role))) {
      return reply.status(request.user ? 403 : 401).send({ error: request.user ? `Requires role: ${roles.join(' or ')}` : 'Authentication required' });
    }
  },
}));

const mockedRepo = jest.mocked(syncProviderRepo);
const mockedRuns = jest.mocked(syncRunRepo);
const mockedRunSync = jest.mocked(runSync);

async function appFor(role: 'admin' | 'technician' | null) {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    if (role) {
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
    }
  });
  await app.register(syncRoutes);
  await app.ready();
  return app;
}

describe('sync job access and validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('denies technicians (and anonymous callers) read access to jobs and the log — this is an admin console surface', async () => {
    const anon = await appFor(null);
    const tech = await appFor('technician');
    try {
      expect((await anon.inject({ method: 'GET', url: '/sync/providers' })).statusCode).toBe(401);
      expect((await tech.inject({ method: 'GET', url: '/sync/providers' })).statusCode).toBe(403);
      expect((await tech.inject({ method: 'GET', url: '/sync/runs' })).statusCode).toBe(403);
      expect((await tech.inject({ method: 'GET', url: '/sync/log' })).statusCode).toBe(403);
      expect((await tech.inject({ method: 'POST', url: '/sync/run' })).statusCode).toBe(403);
      expect(mockedRepo.list).not.toHaveBeenCalled();
    } finally {
      await anon.close();
      await tech.close();
    }
  });

  it('lets an admin list jobs through the safe DTO', async () => {
    mockedRepo.list.mockResolvedValue([
      {
        id: 1,
        name: 'Jira — SpillersTech',
        type: 'jira',
        enabled: true,
        lastSyncedAt: null,
        configRevision: 4,
        createdAt: new Date(),
        connectionId: 3,
        config: { projectKey: 'HELP', apiToken: 'should-never-appear' },
      },
    ] as never);
    mockedRuns.healthForProviders.mockResolvedValue(
      new Map([
        [
          1,
          {
            status: 'failing',
            lastAttemptAt: new Date('2026-07-25T12:00:00Z'),
            lastSuccessAt: null,
            consecutiveFailures: 2,
            latestError: 'authentication rejected',
            latestRun: null,
          },
        ],
      ])
    );
    const admin = await appFor('admin');
    try {
      const res = await admin.inject({ method: 'GET', url: '/sync/providers' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body[0]).toMatchObject({
        id: 1,
        connectionId: 3,
        config: { projectKey: 'HELP' },
        health: { status: 'failing', consecutiveFailures: 2 },
      });
      expect(JSON.stringify(body)).not.toContain('should-never-appear');
      expect(mockedRuns.healthForProviders).toHaveBeenCalledWith([
        { id: 1, configRevision: 4 },
      ]);
    } finally {
      await admin.close();
    }
  });

  it('attributes a manual run to the current admin', async () => {
    const provider = {
      id: 1,
      name: 'Jira job',
      type: 'jira',
      enabled: true,
      lastSyncedAt: null,
      createdAt: new Date(),
      connectionId: 3,
      config: {},
    };
    mockedRepo.getByName.mockResolvedValue(provider as never);
    mockedRunSync.mockResolvedValue({
      runId: 8,
      providerId: 1,
      providerName: 'Jira job',
      status: 'success',
      ticketsCreated: 0,
      ticketsUpdated: 0,
      notesUpserted: 0,
      ticketsFiltered: 0,
      ticketsSkipped: 0,
      ticketsConflicted: 0,
      errorCount: 0,
      errors: [],
      durationMs: 10,
    });
    const admin = await appFor('admin');
    try {
      const res = await admin.inject({ method: 'POST', url: '/sync/run?provider=Jira%20job' });
      expect(res.statusCode).toBe(200);
      expect(mockedRunSync).toHaveBeenCalledWith(provider, { trigger: 'manual', actor: 'admin' });
    } finally {
      await admin.close();
    }
  });

  it('lists durable run summaries and validates the limit', async () => {
    mockedRuns.list.mockResolvedValue([
      {
        id: 8,
        providerId: 1,
        trigger: 'manual',
        status: 'success',
        initiatedBy: 'admin',
        startedAt: new Date('2026-07-25T12:00:00Z'),
        completedAt: new Date('2026-07-25T12:00:01Z'),
        durationMs: 1000,
        ticketsCreated: 0,
        ticketsUpdated: 0,
        notesUpserted: 0,
        ticketsFiltered: 0,
        ticketsSkipped: 0,
        ticketsConflicted: 0,
        errorCount: 0,
        latestError: null,
        provider: { name: 'Jira job', type: 'jira' },
      },
    ] as never);
    const admin = await appFor('admin');
    try {
      const ok = await admin.inject({ method: 'GET', url: '/sync/runs?provider=Jira%20job&limit=20' });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()[0]).toMatchObject({
        id: 8,
        status: 'success',
        provider: { name: 'Jira job', type: 'jira' },
      });
      expect(mockedRuns.list).toHaveBeenCalledWith({ providerName: 'Jira job', limit: 20 });

      const bad = await admin.inject({ method: 'GET', url: '/sync/runs?limit=NaN' });
      expect(bad.statusCode).toBe(400);
    } finally {
      await admin.close();
    }
  });

  it('returns one run with BigInt log ids mapped for JSON', async () => {
    mockedRuns.getWithLogs.mockResolvedValue({
      id: 8,
      providerId: 1,
      trigger: 'manual',
      status: 'degraded',
      initiatedBy: 'admin',
      startedAt: new Date('2026-07-25T12:00:00Z'),
      completedAt: new Date('2026-07-25T12:00:01Z'),
      durationMs: 1000,
      ticketsCreated: 0,
      ticketsUpdated: 1,
      notesUpserted: 0,
      ticketsFiltered: 2,
      ticketsSkipped: 0,
      ticketsConflicted: 1,
      errorCount: 1,
      latestError: 'held conflict',
      provider: { name: 'Jira job', type: 'jira' },
      _count: { syncLogs: 700 },
      syncLogs: [
        {
          id: BigInt(9001),
          providerId: 1,
          runId: 8,
          externalId: 'HELP-1',
          internalId: 4,
          direction: 'inbound',
          status: 'skipped',
          message: 'held conflict Authorization: Bearer secret-value',
          syncedAt: new Date('2026-07-25T12:00:00Z'),
        },
      ],
    } as never);
    const admin = await appFor('admin');
    try {
      const res = await admin.inject({ method: 'GET', url: '/sync/runs/8' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: 8,
        status: 'degraded',
        logCount: 700,
        logsTruncated: true,
        logs: [{ id: 9001, runId: 8, status: 'skipped' }],
      });
      expect(res.json().logs[0].message).toContain('[redacted]');
      expect(res.json().logs[0].message).not.toContain('secret-value');
    } finally {
      await admin.close();
    }
  });

  it('rejects a job config field that does not belong to this type', async () => {
    mockedRepo.create.mockImplementation(() => {
      throw new syncProviderRepo.SyncProviderValidationError('unknown config field "jql" for connectwise (allowed: board, filter)');
    });
    const admin = await appFor('admin');
    try {
      const res = await admin.inject({
        method: 'POST',
        url: '/sync/providers',
        payload: { name: 'CW board', type: 'connectwise', config: { jql: 'x' } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/unknown config field "jql"/);
    } finally {
      await admin.close();
    }
  });

  it('rejects a non-integer connectionId before it reaches the repository', async () => {
    const admin = await appFor('admin');
    try {
      const res = await admin.inject({
        method: 'POST',
        url: '/sync/providers',
        payload: { name: 'Jira job', type: 'jira', connectionId: 'not-a-number' },
      });
      expect(res.statusCode).toBe(400);
      expect(mockedRepo.create).not.toHaveBeenCalled();
    } finally {
      await admin.close();
    }
  });

  // A malformed body must 400 at the route, not reach the repository and crash
  // on e.g. Object.entries(null) or a non-string .trim() — regression cases
  // for a review that found each of these reaching the repository unvalidated.
  it.each([
    ['config: null', { name: 'Jira job', type: 'jira', config: null }],
    ['numeric name', { name: 12345, type: 'jira' }],
    ['non-boolean enabled', { name: 'Jira job', type: 'jira', enabled: 'false' }],
  ])('POST /sync/providers rejects %s with 400, not the repository', async (_label, payload) => {
    const admin = await appFor('admin');
    try {
      const res = await admin.inject({ method: 'POST', url: '/sync/providers', payload });
      expect(res.statusCode).toBe(400);
      expect(mockedRepo.create).not.toHaveBeenCalled();
    } finally {
      await admin.close();
    }
  });

  it('PATCH rejects config: null with 400 instead of crashing the repository', async () => {
    const admin = await appFor('admin');
    try {
      const res = await admin.inject({ method: 'PATCH', url: '/sync/providers/1', payload: { config: null } });
      expect(res.statusCode).toBe(400);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    } finally {
      await admin.close();
    }
  });

  it.each([
    ['blank', '   ', /name is required/],
    ['overlong', 'x'.repeat(101), /100 characters or fewer/],
  ])('PATCH rejects a %s name before it reaches the repository', async (_label, name, expected) => {
    const admin = await appFor('admin');
    try {
      const res = await admin.inject({
        method: 'PATCH',
        url: '/sync/providers/1',
        payload: { name },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(expected);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    } finally {
      await admin.close();
    }
  });

  it('PATCH rejects a body with only unrecognized fields instead of a silent no-op update', async () => {
    const admin = await appFor('admin');
    try {
      const res = await admin.inject({ method: 'PATCH', url: '/sync/providers/1', payload: { type: 'connectwise' } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/no recognized fields/);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    } finally {
      await admin.close();
    }
  });

  it('passes connectionId and config through to update, and returns 404 for a missing job', async () => {
    mockedRepo.update.mockResolvedValueOnce(null);
    const admin = await appFor('admin');
    try {
      const res = await admin.inject({
        method: 'PATCH',
        url: '/sync/providers/99',
        payload: { connectionId: 5, config: { jql: 'assignee = x' } },
      });
      expect(res.statusCode).toBe(404);
      expect(mockedRepo.update).toHaveBeenCalledWith(
        99,
        { connectionId: 5, config: { jql: 'assignee = x' } },
        'admin'
      );
    } finally {
      await admin.close();
    }
  });

  it('surfaces a repository validation error (e.g. connection type mismatch) as 400', async () => {
    mockedRepo.update.mockImplementation(() => {
      throw new syncProviderRepo.SyncProviderValidationError('connection 5 is a connectwise account, not jira');
    });
    const admin = await appFor('admin');
    try {
      const res = await admin.inject({
        method: 'PATCH',
        url: '/sync/providers/1',
        payload: { connectionId: 5 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/not jira/);
    } finally {
      await admin.close();
    }
  });

  it('returns 409 when another replica is actively running the job being edited', async () => {
    mockedRepo.update.mockImplementation(() => {
      throw new syncProviderRepo.SyncProviderBusyError(
        'wait for the active sync run to finish before changing its account or scope'
      );
    });
    const admin = await appFor('admin');
    try {
      const res = await admin.inject({
        method: 'PATCH',
        url: '/sync/providers/1',
        payload: { config: { projectKey: 'OPS' } },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatch(/active sync run/);
    } finally {
      await admin.close();
    }
  });

  it('404s deleting a job that does not exist', async () => {
    mockedRepo.remove.mockResolvedValue(false);
    const admin = await appFor('admin');
    try {
      const res = await admin.inject({ method: 'DELETE', url: '/sync/providers/1' });
      expect(res.statusCode).toBe(404);
    } finally {
      await admin.close();
    }
  });
});
