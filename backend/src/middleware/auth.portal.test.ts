// The 2.7 release gate defaults the portal OFF. These suites exercise the
// portal working, so they run with it switched on; portalEnabled.test.ts owns
// the default-off behaviour.
jest.mock('../services/settingsService', () => ({
  isPortalEnabled: jest.fn().mockResolvedValue(true),
}));

jest.mock('openid-client', () => ({}));
jest.mock('../config/config', () => ({
  config: { oidcDisabled: false },
}));
jest.mock('../services/auth/sessions', () => ({
  resolveScopedSession: jest.fn(),
  SESSION_COOKIE: 'mt_session',
}));
jest.mock('../services/auth/authConfig', () => ({
  getAuthSettings: jest.fn(),
}));
jest.mock('../repositories/userRepository', () => ({
  upsertSso: jest.fn(),
}));
jest.mock('../services/auth/apiTokens', () => ({
  isPatFormat: jest.fn(() => false),
  resolve: jest.fn(),
}));
jest.mock('../services/auth/mcpOAuth', () => ({
  mcpWwwAuthenticateHeader: jest.fn(
    () => 'Bearer realm="anchordesk-mcp"',
  ),
}));

import Fastify, { FastifyInstance } from 'fastify';
import { config } from '../config/config';
import * as apiTokens from '../services/auth/apiTokens';
import * as sessions from '../services/auth/sessions';
import type { RequesterPrincipal } from '../types/principal';
import { registerAuthHook } from './auth';

const resolveScopedSession = sessions.resolveScopedSession as jest.Mock;
const isPatFormat = apiTokens.isPatFormat as jest.Mock;

const requester: RequesterPrincipal = {
  kind: 'requester',
  contactId: 22,
  companyId: 9,
  name: 'Rita Requester',
  email: 'rita@example.com',
};

describe('portal session auth boundary', () => {
  let app: FastifyInstance;
  let staffHandlerCalls: number;

  beforeEach(async () => {
    jest.clearAllMocks();
    config.oidcDisabled = false;
    staffHandlerCalls = 0;
    resolveScopedSession.mockResolvedValue(requester);

    app = Fastify();
    app.addHook('onRequest', async (request) => {
      (
        request as typeof request & {
          cookies: Record<string, string>;
        }
      ).cookies = { mt_session: 'portal-session-token' };
    });
    await registerAuthHook(app);
    app.get('/tickets', async () => {
      staffHandlerCalls++;
      return { confidential: true };
    });
    app.post('/auth/logout', async () => {
      staffHandlerCalls++;
      return { ok: true };
    });
    app.get('/portal/tickets', async (request) => ({
      kind: request.principal.kind,
      actor: request.actorSub,
      channel: request.authChannel,
      hasStaffUser: Boolean(request.user),
    }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects a portal session before a staff route handler runs', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tickets',
      headers: {
        authorization: 'Bearer a-staff-token-must-not-bypass-portal-scope',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Portal session is not permitted for this route',
    });
    expect(staffHandlerCalls).toBe(0);
    expect(isPatFormat).not.toHaveBeenCalled();
  });

  it('does not let a public staff-auth route bypass the portal allowlist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    });

    expect(response.statusCode).toBe(403);
    expect(staffHandlerCalls).toBe(0);
  });

  it('permits an exact allowlisted portal route with a distinct requester actor', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/portal/tickets',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      kind: 'requester',
      actor: 'requester:22 (portal)',
      channel: 'portal',
      hasStaffUser: false,
    });
  });

  it('preserves requester scope under the local dev auth bypass', async () => {
    await app.close();
    config.oidcDisabled = true;

    app = Fastify();
    app.addHook('onRequest', async (request) => {
      (
        request as typeof request & {
          cookies: Record<string, string>;
        }
      ).cookies = { mt_session: 'portal-session-token' };
    });
    await registerAuthHook(app);
    app.get('/portal/tickets', async (request) => ({
      kind: request.principal.kind,
      actor: request.actorSub,
      channel: request.authChannel,
      hasStaffUser: Boolean(request.user),
    }));
    app.get('/tickets', async () => {
      staffHandlerCalls++;
      return { confidential: true };
    });
    await app.ready();

    const portalResponse = await app.inject({
      method: 'GET',
      url: '/portal/tickets',
    });
    const staffResponse = await app.inject({
      method: 'GET',
      url: '/tickets',
    });

    expect(portalResponse.statusCode).toBe(200);
    expect(portalResponse.json()).toEqual({
      kind: 'requester',
      actor: 'requester:22 (portal)',
      channel: 'portal',
      hasStaffUser: false,
    });
    expect(staffResponse.statusCode).toBe(403);
    expect(staffHandlerCalls).toBe(0);
  });
});
