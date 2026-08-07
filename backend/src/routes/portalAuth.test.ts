// The 2.7 release gate defaults the portal OFF. These suites exercise the
// portal working, so they run with it switched on; portalEnabled.test.ts owns
// the default-off behaviour.
jest.mock('../services/settingsService', () => ({
  isPortalEnabled: jest.fn().mockResolvedValue(true),
  getPortal: jest.fn().mockResolvedValue({ allowSelfSolve: true }),
  getFeedback: jest.fn().mockResolvedValue({ enabled: true, promptOnSolve: true }),
}));

jest.mock('../services/auth/portalMagicLinks', () => ({
  requestMagicLink: jest.fn(),
  redeemMagicLink: jest.fn(),
}));

jest.mock('../services/auth/sessions', () => ({
  clearSessionCookie: jest.fn(),
  hashSessionToken: jest.fn(() => 'hashed-session-token'),
  PORTAL_SESSION_TTL_MS: 24 * 60 * 60 * 1000,
  SESSION_COOKIE: 'mt_session',
  setSessionCookie: jest.fn(),
}));
jest.mock('../repositories/portalAuthRepository', () => ({
  revokePortalSession: jest.fn(),
}));
jest.mock('../middleware/auth', () => ({
  actorFor: (username: string, channel: string) => `${username} (${channel})`,
}));

import Fastify, { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import * as magicLinks from '../services/auth/portalMagicLinks';
import * as sessions from '../services/auth/sessions';
import * as portalAuthRepository from '../repositories/portalAuthRepository';
import type { RequesterPrincipal } from '../types/principal';
import {
  MAGIC_LINK_GENERIC_RESPONSE,
  portalAuthRoutes,
  toPublicRequesterIdentity,
} from './portalAuth';

const requestMagicLink = magicLinks.requestMagicLink as jest.Mock;
const redeemMagicLink = magicLinks.redeemMagicLink as jest.Mock;
const clearSessionCookie = sessions.clearSessionCookie as jest.Mock;
const revokePortalSession =
  portalAuthRepository.revokePortalSession as jest.Mock;
const setSessionCookie = sessions.setSessionCookie as jest.Mock;

const requester: RequesterPrincipal = {
  kind: 'requester',
  contactId: 22,
  companyId: 9,
  name: 'Rita Requester',
  email: 'rita@example.com',
};

async function nextImmediate(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('portal auth routes', () => {
  let app: FastifyInstance;
  let requestPrincipal: unknown;

  beforeEach(async () => {
    jest.clearAllMocks();
    requestPrincipal = undefined;
    app = Fastify();
    await app.register(formbody);
    await app.register(rateLimit, { global: false });
    app.addHook('onRequest', async (request) => {
      if (requestPrincipal !== undefined) {
        (
          request as unknown as { principal: unknown }
        ).principal = requestPrincipal;
      }
      (request as typeof request & { cookies: Record<string, string> }).cookies =
        { mt_session: 'raw-session-token' };
    });
    await app.register(portalAuthRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the exact same generic response before lookup/delivery completes', async () => {
    let finishKnown: (() => void) | undefined;
    requestMagicLink
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishKnown = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);

    const known = await app.inject({
      method: 'POST',
      url: '/portal/auth/magic-link',
      payload: { email: 'known@example.com' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/portal/auth/magic-link',
      payload: { email: 'unknown@example.com' },
    });

    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.json()).toEqual(MAGIC_LINK_GENERIC_RESPONSE);
    expect(unknown.json()).toEqual(MAGIC_LINK_GENERIC_RESPONSE);
    expect(known.body).toBe(unknown.body);
    expect(known.headers['cache-control']).toBe('no-store');
    expect(unknown.headers['cache-control']).toBe('no-store');

    await nextImmediate();
    expect(requestMagicLink).toHaveBeenCalledTimes(2);
    finishKnown?.();
  });

  it('does not change the public response when background delivery fails', async () => {
    requestMagicLink.mockRejectedValueOnce(new Error('recipient secret'));

    const response = await app.inject({
      method: 'POST',
      url: '/portal/auth/magic-link',
      payload: { email: 'known@example.com' },
    });
    await nextImmediate();

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual(MAGIC_LINK_GENERIC_RESPONSE);
  });

  it('rate-limits by normalized recipient without collapsing customers behind one proxy IP', async () => {
    requestMagicLink.mockResolvedValue(undefined);

    for (const email of [
      'RITA@example.com',
      'rita@example.com',
      'rita@example.com',
      'rita@example.com',
      'rita@example.com',
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/portal/auth/magic-link',
        payload: { email },
      });
      expect(response.statusCode).toBe(202);
    }

    const throttled = await app.inject({
      method: 'POST',
      url: '/portal/auth/magic-link',
      payload: { email: 'rita@example.com' },
    });
    const otherRecipient = await app.inject({
      method: 'POST',
      url: '/portal/auth/magic-link',
      payload: { email: 'casey@example.com' },
    });

    expect(throttled.statusCode).toBe(429);
    expect(otherRecipient.statusCode).toBe(202);
  });

  it('serializes only the explicit public requester identity keys', () => {
    const futureContact = {
      ...requester,
      phone: '555-0100',
      internalMemo: 'must never leak',
      apiSecret: 'future-secret',
    };

    const publicIdentity = toPublicRequesterIdentity(futureContact);
    expect(publicIdentity).toEqual({
      displayName: 'Rita Requester',
      email: 'rita@example.com',
    });
    expect(Object.keys(publicIdentity).sort()).toEqual([
      'displayName',
      'email',
    ]);
    expect(JSON.stringify(publicIdentity)).not.toContain('future-secret');
  });

  it('sets a 24-hour portal cookie and returns public identity plus the authenticated portal feature gates on verify', async () => {
    redeemMagicLink.mockResolvedValue({
      requester,
      sessionToken: 'new-session-token',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/portal/auth/verify',
      payload: { token: 'adp_selector.verifier' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      requester: {
        displayName: 'Rita Requester',
        email: 'rita@example.com',
      },
      config: { feedbackEnabled: true, promptOnSolve: true, allowSelfSolve: true },
    });
    expect(setSessionCookie).toHaveBeenCalledWith(
      expect.anything(),
      'new-session-token',
      24 * 60 * 60 * 1000,
    );
  });

  it('makes invalid, expired, and replayed verify failures indistinguishable', async () => {
    redeemMagicLink.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/portal/auth/verify',
      payload: { token: 'invalid' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'Invalid or expired sign-in link',
    });
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('rejects form-based token redemption before it can swap the session cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/portal/auth/verify',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'token=attacker-token',
    });

    expect(response.statusCode).toBe(415);
    expect(redeemMagicLink).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it('returns the public identity and portal feature gates from the authenticated me endpoint', async () => {
    requestPrincipal = requester;

    const response = await app.inject({
      method: 'GET',
      url: '/portal/auth/me',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      requester: {
        displayName: 'Rita Requester',
        email: 'rita@example.com',
      },
      config: { feedbackEnabled: true, promptOnSolve: true, allowSelfSolve: true },
    });
  });

  it('rejects staff or absent principals from requester-only endpoints', async () => {
    requestPrincipal = {
      kind: 'staff',
      user: { id: 1, username: 'alice' },
    };
    const staffResponse = await app.inject({
      method: 'GET',
      url: '/portal/auth/me',
    });
    requestPrincipal = undefined;
    const absentResponse = await app.inject({
      method: 'POST',
      url: '/portal/auth/logout',
    });

    expect(staffResponse.statusCode).toBe(403);
    expect(absentResponse.statusCode).toBe(403);
    expect(revokePortalSession).not.toHaveBeenCalled();
  });

  it('destroys only the presented requester session on logout', async () => {
    requestPrincipal = requester;

    const response = await app.inject({
      method: 'POST',
      url: '/portal/auth/logout',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(revokePortalSession).toHaveBeenCalledWith({
      contactId: 22,
      tokenHash: 'hashed-session-token',
      actor: 'requester:22 (portal)',
    });
    expect(clearSessionCookie).toHaveBeenCalledWith(expect.anything());
  });
});
