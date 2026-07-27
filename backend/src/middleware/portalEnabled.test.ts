/**
 * The 2.7 release gate: the customer portal is off until an admin turns it on.
 *
 * Both the portal and the knowledge base are fully built and fully tested. The
 * risk this closes is not a leak, it is *acquisition*: upgrading AnchorDesk
 * must not hand a shop a live customer-facing surface it never asked for.
 * Without the gate, `requestMagicLink` would issue a sign-in link to any
 * uniquely-matching Contact in the CRM, and KB portal reads would answer
 * anonymously — AnchorDesk's first unauthenticated data-returning endpoint.
 *
 * Default-off is the whole feature, so it is tested directly rather than
 * inferred from the settings plumbing.
 */
jest.mock('../services/settingsService', () => ({
  isPortalEnabled: jest.fn(),
}));

import { isPortalEnabled } from '../services/settingsService';
import { authorizePortalKbRead, isPortalKbReadRequest } from './kbPortalAccess';

const enabled = isPortalEnabled as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('knowledge-base portal reads are gated by the portal switch', () => {
  const portalSearch = { method: 'GET', url: '/kb/search?q=vpn&visibility=portal' };
  const portalArticle = { method: 'GET', url: '/kb/portal/reset-a-password' };

  it.each([portalSearch, portalArticle])(
    'refuses %o while the portal is disabled',
    async (request) => {
      enabled.mockResolvedValue(false);
      await expect(authorizePortalKbRead(request)).resolves.toBe(false);
    },
  );

  it.each([portalSearch, portalArticle])(
    'permits %o once an admin enables the portal',
    async (request) => {
      enabled.mockResolvedValue(true);
      await expect(authorizePortalKbRead(request)).resolves.toBe(true);
    },
  );

  // The gate answers "may anyone ask?" — never "what may they see?". Shapes
  // outside the two published-portal reads stay refused even when enabled, so
  // turning the portal on cannot widen the anonymous surface by accident.
  it.each([
    ['a staff-scoped search', { method: 'GET', url: '/kb/search?q=vpn' }],
    ['an internal-visibility search', { method: 'GET', url: '/kb/search?q=vpn&visibility=internal' }],
    ['a doubled visibility param', { method: 'GET', url: '/kb/search?visibility=portal&visibility=internal' }],
    ['a staff article read', { method: 'GET', url: '/kb/articles/12' }],
    ['a mutation', { method: 'POST', url: '/kb/portal/reset-a-password' }],
    ['a nested path', { method: 'GET', url: '/kb/portal/a/b' }],
  ])('still refuses %s with the portal enabled', async (_case, request) => {
    enabled.mockResolvedValue(true);
    expect(isPortalKbReadRequest(request)).toBe(false);
    await expect(authorizePortalKbRead(request)).resolves.toBe(false);
  });

  it('does not consult the switch for a non-portal shape', async () => {
    enabled.mockResolvedValue(true);
    await authorizePortalKbRead({ method: 'GET', url: '/tickets' });
    expect(enabled).not.toHaveBeenCalled();
  });
});
