/**
 * The allowlist of paths that bypass authentication. Kept in its own
 * dependency-free module so it can be unit-tested without pulling in the
 * (ESM-only) OIDC stack — a route accidentally becoming public is a security
 * bug, so this guard is worth testing in isolation.
 */

// Public auth endpoints: login screen config + the login/callback handshakes.
// The MFA endpoints authorize via a signed pre-session cookie internally.
const PUBLIC_AUTH = [
  '/auth/config',
  // First-run setup: both endpoints refuse to act once any user exists.
  '/auth/setup-status',
  '/auth/setup',
  '/auth/login',
  '/auth/logout',
  '/auth/oidc/login',
  '/auth/oidc/callback',
  '/auth/saml/login',
  '/auth/saml/callback',
  '/auth/saml/metadata',
  '/auth/mfa/verify',
  '/auth/mfa/setup',
  '/auth/mfa/enable',
];

const PUBLIC_PORTAL_AUTH = new Set([
  '/portal/auth/magic-link',
  '/portal/auth/verify',
  '/portal/register',
]);

export function isPublic(url: string, method?: string): boolean {
  const path = url.split('?')[0];
  if (path === '/ping') return true;
  if (path.startsWith('/probe/')) return true;
  if (path === '/.well-known/oauth-protected-resource') return true;
  if (path.startsWith('/.well-known/oauth-protected-resource/')) return true;
  // MCP OAuth authorization-server endpoints. These authenticate via the OAuth
  // handshake itself (register/token) or resolve the session cookie by hand and
  // bounce to login when absent (authorize) — so they bypass the blanket hook.
  if (path === '/.well-known/oauth-authorization-server') return true;
  if (path === '/oauth/register') return true;
  if (path === '/oauth/authorize') return true;
  if (path === '/oauth/token') return true;
  if (PUBLIC_PORTAL_AUTH.has(path)) {
    // Supplying a method is the runtime path; the optional form preserves the
    // dependency-free path checks used by existing unit tests.
    return method === undefined || method.toUpperCase() === 'POST';
  }
  return PUBLIC_AUTH.includes(path);
}

/**
 * Positive allowlist for an authenticated Contact session.
 *
 * This is deliberately method + exact-path based rather than "/portal starts
 * with": a future staff/admin route cannot become requester-accessible merely
 * by being mounted nearby. Public endpoints remain public independently.
 */
export function isPortalSessionAllowed(method: string, url: string): boolean {
  const verb = method.toUpperCase();
  const parsed = new URL(url, 'http://anchordesk.invalid');
  const path = parsed.pathname;

  if (verb === 'GET' && path === '/portal/auth/me') return true;
  if (verb === 'POST' && path === '/portal/auth/logout') return true;
  if (
    verb === 'POST' &&
    (path === '/portal/auth/magic-link' ||
      path === '/portal/auth/verify' ||
      path === '/portal/register')
  ) {
    return true;
  }

  if (
    (verb === 'GET' || verb === 'POST') &&
    path === '/portal/tickets'
  ) {
    return true;
  }
  if (verb === 'GET' && /^\/portal\/tickets\/[1-9]\d*$/.test(path)) {
    return true;
  }
  if (
    verb === 'POST' &&
    /^\/portal\/tickets\/[1-9]\d*\/(?:comments|attachments)$/.test(path)
  ) {
    return true;
  }
  if (
    verb === 'GET' &&
    /^\/portal\/attachments\/[1-9]\d*\/download$/.test(path)
  ) {
    return true;
  }

  if (verb === 'GET' && path === '/kb/search') {
    // This is the only requester route outside /portal. Admit exactly the
    // published deflection contract so a future staff-only KB flag cannot be
    // smuggled through merely by also supplying visibility=portal.
    const keys = Array.from(parsed.searchParams.keys());
    if (keys.some((key) => !['q', 'visibility', 'limit'].includes(key))) {
      return false;
    }
    const query = parsed.searchParams.getAll('q');
    const visibility = parsed.searchParams.getAll('visibility');
    const limit = parsed.searchParams.getAll('limit');
    return (
      query.length === 1 &&
      query[0].trim().length > 0 &&
      query[0].length <= 500 &&
      visibility.length === 1 &&
      visibility[0] === 'portal' &&
      limit.length === 1 &&
      limit[0] === '5'
    );
  }
  return false;
}
