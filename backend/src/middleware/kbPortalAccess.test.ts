import { authorizePortalKbRead, isPortalKbReadRequest } from './kbPortalAccess';

const requester = {
  kind: 'requester',
  contactId: 22,
  companyId: 9,
  name: 'Rita Requester',
  email: 'rita@example.com',
};

describe('portal KB authorization seam', () => {
  it.each([
    ['/kb/search?q=reset&visibility=portal&limit=5'],
    ['/kb/portal/reset-password'],
  ])('admits only a requester on the explicit portal read path: %s', async (url) => {
    const request = { method: 'GET', url, principal: requester };
    expect(isPortalKbReadRequest(request as never)).toBe(true);
    await expect(authorizePortalKbRead(request as never)).resolves.toBe(true);
  });

  it.each([
    ['GET', '/kb/search?q=reset'],
    ['GET', '/kb/search?visibility=portal&q=reset'],
    ['GET', '/kb/search?q=reset&visibility=internal'],
    ['GET', '/kb/search?q=reset&visibility=portal&limit=4'],
    ['GET', '/kb/search?q=reset&visibility=portal&visibility=internal'],
    ['POST', '/kb/search?q=reset&visibility=portal'],
    ['GET', '/kb/articles/1'],
    ['GET', '/kb/portal/Reset-Password'],
    ['GET', '/kb/portal/reset-password?preview=true'],
    ['GET', '/kb/portal/reset-password/extra'],
    ['GET', `/kb/portal/${'a'.repeat(201)}`],
  ])('fails closed for %s %s', async (method, url) => {
    const request = { method, url, principal: requester };
    expect(isPortalKbReadRequest(request as never)).toBe(false);
    await expect(authorizePortalKbRead(request as never)).resolves.toBe(false);
  });

  it.each([
    [undefined],
    [{ kind: 'staff', user: { role: 'readonly' } }],
    [{ ...requester, contactId: 0 }],
  ])('never treats an anonymous, staff, or malformed principal as a requester', async (principal) => {
    const request = {
      method: 'GET',
      url: '/kb/search?q=reset&visibility=portal&limit=5',
      principal,
    };
    expect(isPortalKbReadRequest(request as never)).toBe(true);
    await expect(authorizePortalKbRead(request as never)).resolves.toBe(false);
  });
});
