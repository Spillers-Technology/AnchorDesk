import Fastify from 'fastify';
import * as deviceRepo from '../repositories/deviceRepository';
import { deviceRoutes } from './devices';

jest.mock('../repositories/deviceRepository', () => ({
  list: jest.fn(),
  getById: jest.fn(),
  getExternalRefForProvider: jest.fn(),
  listExternalRefs: jest.fn(),
  addExternalRef: jest.fn(),
  removeExternalRef: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  listForTicket: jest.fn(),
  link: jest.fn(),
  unlink: jest.fn(),
}));
jest.mock('../repositories/auditRepository', () => ({ getHistory: jest.fn() }));
jest.mock('../rmm/registry', () => ({ getAdapter: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  requireRole: (...roles: string[]) => async (request: { user?: { role?: string } }, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) => {
    if (!request.user || !roles.includes(String(request.user.role))) {
      return reply.status(request.user ? 403 : 401).send({ error: request.user ? `Requires role: ${roles.join(' or ')}` : 'Authentication required' });
    }
  },
}));

const mockedRepo = jest.mocked(deviceRepo);

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
  await app.register(deviceRoutes);
  await app.ready();
  return app;
}

describe('device identity access and validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps external-reference reads available but denies technician mutations', async () => {
    mockedRepo.getById.mockResolvedValue({ id: 4 } as never);
    mockedRepo.listExternalRefs.mockResolvedValue([]);
    const app = await appFor('technician');
    try {
      expect((await app.inject({ method: 'GET', url: '/devices/4/external-refs' })).statusCode).toBe(200);
      expect((await app.inject({
        method: 'POST',
        url: '/devices/4/external-refs',
        payload: { provider: 'ninjaone', externalId: 'n-4' },
      })).statusCode).toBe(403);
      expect((await app.inject({
        method: 'DELETE',
        url: '/devices/4/external-refs/9',
      })).statusCode).toBe(403);
      expect(mockedRepo.addExternalRef).not.toHaveBeenCalled();
      expect(mockedRepo.removeExternalRef).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('allows an admin to add a canonicalized, validated reference', async () => {
    mockedRepo.addExternalRef.mockImplementation(async (_id, input) => ({
      id: 8,
      deviceId: 4,
      provider: input.provider,
      externalId: input.externalId,
    } as never));
    const app = await appFor('admin');
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/devices/4/external-refs',
        payload: { provider: 'Ninja-One', externalId: ' n-4 ' },
      });
      expect(response.statusCode).toBe(201);
      expect(mockedRepo.addExternalRef).toHaveBeenCalledWith(
        4,
        expect.objectContaining({ provider: 'ninjaone', externalId: 'n-4' }),
        'admin',
      );
    } finally {
      await app.close();
    }
  });

  it('lets technicians edit asset fields but not legacy identity', async () => {
    mockedRepo.update.mockResolvedValue({ id: 4, assetTag: 'A-4' } as never);
    const app = await appFor('technician');
    try {
      const asset = await app.inject({
        method: 'PATCH',
        url: '/devices/4',
        payload: { assetTag: ' A-4 ', purchaseDate: '2026-07-15' },
      });
      expect(asset.statusCode).toBe(200);
      expect(mockedRepo.update).toHaveBeenCalledWith(
        4,
        expect.objectContaining({ assetTag: 'A-4', purchaseDate: new Date('2026-07-15T00:00:00.000Z') }),
        'technician',
      );

      mockedRepo.update.mockClear();
      const identity = await app.inject({
        method: 'PATCH',
        url: '/devices/4',
        payload: { externalId: 'agent-4', externalProvider: 'tactical_rmm' },
      });
      expect(identity.statusCode).toBe(403);
      expect(mockedRepo.update).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects malformed external identities before repository writes', async () => {
    const app = await appFor('admin');
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/devices/4',
        payload: { externalId: 'agent-4' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'externalId and externalProvider must be supplied together' });
      expect(mockedRepo.update).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
