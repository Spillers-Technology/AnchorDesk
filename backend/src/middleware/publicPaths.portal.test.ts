import {
  isPortalSessionAllowed,
  isPublic,
} from './publicPaths';

describe('requester positive route allowlist', () => {
  it.each([
    ['GET', '/portal/auth/me'],
    ['POST', '/portal/auth/logout'],
    ['POST', '/portal/register'],
    ['GET', '/portal/tickets'],
    ['POST', '/portal/tickets'],
    ['GET', '/portal/tickets/42'],
    ['POST', '/portal/tickets/42/comments'],
    ['POST', '/portal/tickets/42/attachments'],
    ['GET', '/portal/attachments/17/download'],
    ['GET', '/portal-profile-avatar/12.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12'],
    ['GET', '/kb/search?q=printer&visibility=portal&limit=5'],
  ])('admits only the published requester operation: %s %s', (method, url) => {
    expect(isPortalSessionAllowed(method, url)).toBe(true);
  });

  it.each([
    ['GET', '/tickets'],
    ['POST', '/auth/logout'],
    ['GET', '/portal/admin'],
    ['DELETE', '/portal/tickets/42'],
    ['GET', '/portal/tickets/42/notes'],
    ['GET', '/portal/tickets/0'],
    ['GET', '/kb/search?q=printer&visibility=internal&limit=5'],
    ['GET', '/kb/search?q=printer&visibility=portal&limit=50'],
    ['GET', '/kb/search?q=printer&visibility=portal&limit=5&include=drafts'],
  ])('rejects everything outside the exact allowlist: %s %s', (method, url) => {
    expect(isPortalSessionAllowed(method, url)).toBe(false);
  });

  it('keeps public portal authentication endpoints method-specific', () => {
    expect(isPublic('/portal/auth/magic-link', 'POST')).toBe(true);
    expect(isPublic('/portal/auth/verify', 'POST')).toBe(true);
    expect(isPublic('/portal/register', 'POST')).toBe(true);
    expect(isPublic('/portal/auth/magic-link', 'GET')).toBe(false);
    expect(isPublic('/portal/auth/verify', 'GET')).toBe(false);
    expect(isPublic('/portal/register', 'GET')).toBe(false);
  });

  it('makes only signed avatar reads public', () => {
    const token = '12.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12';
    expect(isPublic(`/portal-profile-avatar/${token}`, 'GET')).toBe(true);
    expect(isPublic(`/portal-profile-avatar/${token}`, 'POST')).toBe(false);
    expect(isPublic('/portal-profile-avatar/12', 'GET')).toBe(false);
  });
});
