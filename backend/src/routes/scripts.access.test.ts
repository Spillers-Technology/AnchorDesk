import Fastify from 'fastify';
import * as scriptService from '../services/scriptService';
import * as deviceSync from '../services/deviceSyncService';
import * as registry from '../rmm/registry';
import { scriptRoutes } from './scripts';

jest.mock('../services/scriptService', () => ({ runOrSchedule: jest.fn(), refresh: jest.fn() }));
jest.mock('../repositories/scriptJobRepository', () => ({
  listForDevice: jest.fn(),
  listForTicket: jest.fn(),
  getById: jest.fn(),
}));
jest.mock('../services/deviceSyncService', () => ({ syncBySource: jest.fn() }));
jest.mock('../rmm/registry', () => ({ getAdapter: jest.fn(), listAdapters: jest.fn(() => []) }));
jest.mock('../middleware/auth', () => ({
  requireRole: (...roles: string[]) => async (request: { user?: { role?: string } }, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) => {
    if (!request.user || !roles.includes(String(request.user.role))) {
      return reply.status(request.user ? 403 : 401).send({ error: request.user ? `Requires role: ${roles.join(' or ')}` : 'Authentication required' });
    }
  },
}));

const mockedScripts = jest.mocked(scriptService);
const mockedSync = jest.mocked(deviceSync);
const mockedRegistry = jest.mocked(registry);

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
  await app.register(scriptRoutes);
  await app.ready();
  return app;
}

describe('RMM sync and script access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRegistry.listAdapters.mockReturnValue([]);
    mockedRegistry.getAdapter.mockReturnValue({
      key: 'ninjaone',
      label: 'NinjaOne',
      hasScriptCatalog: true,
      isConfigured: () => true,
      provider: jest.fn() as never,
      listScripts: async () => [],
      live: async () => ({}),
    });
  });

  it('requires admin for a device sync', async () => {
    const app = await appFor('technician');
    try {
      const response = await app.inject({ method: 'POST', url: '/devices/sync?provider=ninjaone' });
      expect(response.statusCode).toBe(403);
      expect(mockedSync.syncBySource).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('allows an admin sync and canonicalizes the provider key', async () => {
    mockedSync.syncBySource.mockResolvedValue({
      provider: 'ninjaone', created: 1, updated: 0, errors: [], durationMs: 5,
    });
    const app = await appFor('admin');
    try {
      const response = await app.inject({ method: 'POST', url: '/devices/sync?provider=Ninja-One' });
      expect(response.statusCode).toBe(200);
      expect(mockedRegistry.getAdapter).toHaveBeenCalledWith('ninjaone');
      expect(mockedSync.syncBySource).toHaveBeenCalledWith('ninjaone', 'admin');
    } finally {
      await app.close();
    }
  });

  it('retains technician script runs with strict provider normalization', async () => {
    mockedScripts.runOrSchedule.mockResolvedValue({ id: 11, status: 'queued' } as never);
    const app = await appFor('technician');
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/devices/4/run-script',
        payload: { provider: 'TRMM', script: 9, args: ['-quiet'] },
      });
      expect(response.statusCode).toBe(201);
      expect(mockedScripts.runOrSchedule).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 4, provider: 'tactical_rmm', script: '9' }),
        'technician',
      );
    } finally {
      await app.close();
    }
  });
});
