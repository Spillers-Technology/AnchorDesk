/**
 * Scope-ceiling tests for the `intake` API token scope (STD-005 C1
 * credential — see corporate-strategy standards/STD-005-agent-surface.md and
 * DR-0003). The ceiling itself is enforced centrally in
 * middleware/auth.ts's enforceBaseline()/isIntakeAllowed(), the same choke
 * point every request passes through regardless of route — this suite proves
 * that choke point actually blocks read access on a running app, not just
 * that the helper function returns the right boolean in isolation.
 *
 * "Read access to any ticket" is the requirement, not "read access to
 * tickets the token doesn't own" — an intake token cannot read even the
 * ticket it just created. These tests spin up the real ticketRoutes plus the
 * real registerAuthHook (not a mocked stand-in for it, unlike most other
 * routes/*.test.ts in this repo) specifically so the ceiling under test is
 * the shipped one.
 */
import Fastify from 'fastify';
import * as apiTokens from '../services/auth/apiTokens';
import * as ticketRepo from '../repositories/ticketRepository';
import * as intakeReceipts from '../repositories/intakeReceiptRepository';
import { registerAuthHook } from '../middleware/auth';
import { ticketRoutes } from './tickets';

jest.mock('../services/auth/apiTokens');
jest.mock('../repositories/ticketRepository');
jest.mock('../repositories/intakeReceiptRepository');
// openid-client is ESM-only; the PAT path under test never touches it, but
// importing middleware/auth.ts pulls it in at module load, which Jest can't
// parse without this stand-in.
jest.mock('openid-client', () => ({}));
// Auth needs these to resolve a session lookup / portal gate without a DB.
jest.mock('../services/auth/sessions', () => ({
  resolveScopedSession: jest.fn().mockResolvedValue(null),
  SESSION_COOKIE: 'adk_session',
}));
jest.mock('../middleware/kbPortalAccess', () => ({
  authorizePortalKbRead: jest.fn().mockResolvedValue(false),
}));
jest.mock('../services/settingsService', () => ({
  isPortalEnabled: jest.fn().mockResolvedValue(false),
}));

const mockedApiTokens = jest.mocked(apiTokens);
const mockedTicketRepo = jest.mocked(ticketRepo);
const mockedIntakeReceipts = jest.mocked(intakeReceipts);

const INTAKE_TOKEN = 'adk_' + 'i'.repeat(64);
const FULL_TOKEN = 'adk_' + 'f'.repeat(64);

const INTAKE_USER = {
  id: 9,
  username: 'avr-intake',
  displayName: 'AVR Intake',
  email: null,
  role: 'technician' as const,
  authProvider: 'local',
  isActive: true,
};

async function buildApp() {
  const app = Fastify();
  // registerAuthHook must run directly against the root instance (as
  // src/index.ts does), not via app.register(): Fastify's plugin
  // encapsulation would otherwise confine the onRequest hook to a sibling
  // context and it would never run against ticketRoutes at all.
  await registerAuthHook(app);
  await app.register(ticketRoutes);
  await app.ready();
  return app;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('intake token scope ceiling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApiTokens.isPatFormat.mockImplementation((t: string) => t.startsWith('adk_'));
    mockedApiTokens.resolve.mockImplementation(async (token: string) => {
      if (token === INTAKE_TOKEN) {
        return { user: INTAKE_USER, scope: 'intake', tokenId: 501 } as never;
      }
      if (token === FULL_TOKEN) {
        return { user: INTAKE_USER, scope: 'full', tokenId: 502 } as never;
      }
      return null;
    });
  });

  it('rejects GET /tickets for an intake-scoped token', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/tickets', headers: bearer(INTAKE_TOKEN) });
      expect(res.statusCode).toBe(403);
      expect(mockedTicketRepo.listPaged).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects GET /tickets/:id for an intake-scoped token, including the ticket it just created', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/tickets/4821', headers: bearer(INTAKE_TOKEN) });
      expect(res.statusCode).toBe(403);
      // Blocked before any repository lookup — an intake token gets the same
      // 403 whether ticket 4821 exists or not, so the ceiling itself leaks no
      // existence signal.
      expect(mockedTicketRepo.getById).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects GET /tickets/search for an intake-scoped token', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/tickets/search?q=printer', headers: bearer(INTAKE_TOKEN) });
      expect(res.statusCode).toBe(403);
      expect(mockedTicketRepo.search).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects a mutation on an existing ticket (PATCH) for an intake-scoped token', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/tickets/4821',
        headers: bearer(INTAKE_TOKEN),
        payload: { title: 'renamed' },
      });
      expect(res.statusCode).toBe(403);
      expect(mockedTicketRepo.update).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('allows POST /tickets for an intake-scoped token with a valid Idempotency-Key', async () => {
    mockedIntakeReceipts.claim.mockResolvedValue({ outcome: 'claimed', receiptId: 1 });
    mockedTicketRepo.create.mockResolvedValue({ id: 99, title: 'New call' } as never);
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/tickets',
        headers: { ...bearer(INTAKE_TOKEN), 'idempotency-key': 'call-abc-123' },
        payload: { title: 'New call' },
      });
      expect(res.statusCode).toBe(201);
      expect(mockedTicketRepo.create).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('still allows a full-scope token the entire surface (GET and POST)', async () => {
    mockedTicketRepo.listPaged.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 } as never);
    mockedTicketRepo.create.mockResolvedValue({ id: 100, title: 'Normal ticket' } as never);
    const app = await buildApp();
    try {
      const getRes = await app.inject({ method: 'GET', url: '/tickets', headers: bearer(FULL_TOKEN) });
      expect(getRes.statusCode).toBe(200);

      const postRes = await app.inject({
        method: 'POST',
        url: '/tickets',
        headers: bearer(FULL_TOKEN),
        payload: { title: 'Normal ticket' },
      });
      expect(postRes.statusCode).toBe(201);
      expect(mockedIntakeReceipts.claim).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
