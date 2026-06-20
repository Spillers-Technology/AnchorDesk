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

export function isPublic(url: string): boolean {
  const path = url.split('?')[0];
  if (path === '/ping') return true;
  if (path.startsWith('/probe/')) return true;
  return PUBLIC_AUTH.includes(path);
}
