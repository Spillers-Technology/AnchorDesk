import Fastify from 'fastify';
import * as connectionRepo from '../repositories/connectionRepository';
import { connectionRoutes } from './connections';

jest.mock('../repositories/connectionRepository', () => {
  const actual = jest.requireActual('../repositories/connectionRepository');
  return {
    ...actual,
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    recordTestResult: jest.fn(),
  };
});
jest.mock('../services/connectionTest', () => ({ testConnection: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  requireRole:
    (...roles: string[]) =>
    async (
      request: { user?: { role?: string } },
      reply: { status: (code: number) => { send: (body: unknown) => unknown } }
    ) => {
      if (!request.user || !roles.includes(String(request.user.role))) {
        return reply
          .status(request.user ? 403 : 401)
          .send({ error: request.user ? `Requires role: ${roles.join(' or ')}` : 'Authentication required' });
      }
    },
}));

const mockedRepo = jest.mocked(connectionRepo);

async function adminApp() {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.user = {
      id: 1,
      username: 'admin',
      displayName: 'Admin',
      email: null,
      role: 'admin',
      authProvider: 'local',
      themePref: null,
      kanbanColumns: null,
    };
    request.actorSub = 'admin';
    request.authChannel = 'web';
  });
  await app.register(connectionRoutes);
  await app.ready();
  return app;
}

describe('connection route validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['blank', '   ', /name is required/],
    ['overlong', 'x'.repeat(101), /100 characters or fewer/],
  ])('PATCH rejects a %s name before it reaches the repository', async (_label, name, expected) => {
    const app = await adminApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/connections/1',
        payload: { name },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(expected);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns 409 when an update tries to repoint a Jira connection at another tenant', async () => {
    mockedRepo.update.mockRejectedValueOnce(
      new connectionRepo.ConnectionIdentityConflictError(
        'Jira site URL cannot be changed after the connection is created; create a new connection for a different Jira tenant'
      )
    );
    const app = await adminApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/connections/1',
        payload: { config: { baseUrl: 'https://another-tenant.atlassian.net' } },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatch(/cannot be changed after the connection is created/);
      expect(res.json().error).toMatch(/create a new connection/);
    } finally {
      await app.close();
    }
  });

  it('returns 409 when credentials are edited during an active account run', async () => {
    mockedRepo.update.mockRejectedValueOnce(
      new connectionRepo.ConnectionBusyError(
        'wait for the active sync run to finish before changing this connection'
      )
    );
    const app = await adminApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/connections/1',
        payload: { config: { apiToken: 'rotated' } },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatch(/active sync run/);
    } finally {
      await app.close();
    }
  });
});
