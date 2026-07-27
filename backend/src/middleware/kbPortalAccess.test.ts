// The 2.7 release gate defaults the portal OFF. These suites exercise the
// portal working, so they run with it switched on; portalEnabled.test.ts owns
// the default-off behaviour.
jest.mock('../services/settingsService', () => ({
  isPortalEnabled: jest.fn().mockResolvedValue(true),
}));

import { authorizePortalKbRead, isPortalKbReadRequest } from './kbPortalAccess';

describe('portal KB authorization seam', () => {
  it.each([
    ['/kb/search?q=reset&visibility=portal&limit=5'],
    ['/kb/search?visibility=portal&q=reset'],
    ['/kb/portal/reset-password'],
  ])('admits only the explicit portal read path: %s', async (url) => {
    const request = { method: 'GET', url };
    expect(isPortalKbReadRequest(request as never)).toBe(true);
    await expect(authorizePortalKbRead(request as never)).resolves.toBe(true);
  });

  it.each([
    ['GET', '/kb/search?q=reset'],
    ['GET', '/kb/search?q=reset&visibility=internal'],
    ['GET', '/kb/search?q=reset&visibility=portal&visibility=internal'],
    ['POST', '/kb/search?q=reset&visibility=portal'],
    ['GET', '/kb/articles/1'],
    ['GET', '/kb/portal/reset-password/extra'],
  ])('fails closed for %s %s', async (method, url) => {
    const request = { method, url };
    expect(isPortalKbReadRequest(request as never)).toBe(false);
    await expect(authorizePortalKbRead(request as never)).resolves.toBe(false);
  });
});
