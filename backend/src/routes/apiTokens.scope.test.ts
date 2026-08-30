/**
 * POST /auth/tokens scope minting. Complements the DB-free crypto tests in
 * services/auth/__tests__/apiTokens.test.ts and the intake-scope enforcement
 * tests in tickets.intakeScope.test.ts / tickets.intakeCollision.test.ts —
 * this covers the one remaining piece: that a caller can actually mint an
 * `intake`-scoped token (or is rejected for an invalid scope) through the
 * real route.
 */
import Fastify from 'fastify';
import * as apiTokens from '../services/auth/apiTokens';
import { apiTokenRoutes } from './apiTokens';

jest.mock('../services/auth/apiTokens', () => ({
  listForUser: jest.fn(),
  create: jest.fn(),
  revoke: jest.fn(),
}));

const mockedApiTokens = jest.mocked(apiTokens);

async function webApp() {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.user = {
      id: 3, username: 'alice', displayName: 'Alice', email: null,
      role: 'technician', authProvider: 'local', themePref: null, kanbanColumns: null,
    };
    request.actorSub = 'alice';
    request.authChannel = 'web';
  });
  await app.register(apiTokenRoutes);
  await app.ready();
  return app;
}

describe('POST /auth/tokens scope', () => {
  beforeEach(() => jest.clearAllMocks());

  it('defaults to full scope when none is given', async () => {
    mockedApiTokens.create.mockResolvedValue({ token: { id: 1 } as never, secret: 'adk_x' });
    const app = await webApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/auth/tokens', payload: { name: 'My token' } });
      expect(res.statusCode).toBe(201);
      expect(mockedApiTokens.create).toHaveBeenCalledWith(3, 'My token', 'alice', undefined, 'full');
    } finally {
      await app.close();
    }
  });

  it('mints an intake-scoped token when requested', async () => {
    mockedApiTokens.create.mockResolvedValue({ token: { id: 2 } as never, secret: 'adk_y' });
    const app = await webApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/tokens',
        payload: { name: 'AVR receptionist', scope: 'intake' },
      });
      expect(res.statusCode).toBe(201);
      expect(mockedApiTokens.create).toHaveBeenCalledWith(3, 'AVR receptionist', 'alice', undefined, 'intake');
    } finally {
      await app.close();
    }
  });

  it('rejects an invalid scope value before minting anything', async () => {
    const app = await webApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/tokens',
        payload: { name: 'Bad scope', scope: 'admin' },
      });
      expect(res.statusCode).toBe(400);
      expect(mockedApiTokens.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
