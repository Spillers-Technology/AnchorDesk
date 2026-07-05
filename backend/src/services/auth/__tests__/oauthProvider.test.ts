/**
 * Pure-logic guards for the MCP OAuth authorization server: the consent CSRF
 * token must be bound to the session and unforgeable, and error redirects must
 * carry the OAuth error back to the client without dropping state. DB-touching
 * paths (register / authorize / token) are covered by route-level tests.
 */
import {
  consentCsrfToken,
  verifyConsentCsrf,
  errorRedirect,
  buildAuthServerMetadata,
} from '../oauthProvider';

describe('consent CSRF token', () => {
  it('round-trips for the same session token', () => {
    const token = consentCsrfToken('session-abc');
    expect(verifyConsentCsrf('session-abc', token)).toBe(true);
  });

  it('rejects a token minted for a different session', () => {
    const token = consentCsrfToken('session-abc');
    expect(verifyConsentCsrf('session-xyz', token)).toBe(false);
  });

  it('rejects an empty or garbage token without throwing', () => {
    expect(verifyConsentCsrf('session-abc', '')).toBe(false);
    expect(verifyConsentCsrf('session-abc', 'not-a-real-token')).toBe(false);
  });
});

describe('errorRedirect', () => {
  it('appends error + state to the client redirect URI', () => {
    const url = new URL(errorRedirect('https://client.example/cb', 'access_denied', 'st8'));
    expect(url.origin + url.pathname).toBe('https://client.example/cb');
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('st8');
  });

  it('preserves existing query params on the redirect URI and omits absent state', () => {
    const url = new URL(errorRedirect('https://client.example/cb?foo=1', 'invalid_request'));
    expect(url.searchParams.get('foo')).toBe('1');
    expect(url.searchParams.get('error')).toBe('invalid_request');
    expect(url.searchParams.has('state')).toBe(false);
  });
});

describe('authorization-server metadata', () => {
  it('only advertises PKCE (S256) and the authorization-code grant for public clients', () => {
    const meta = buildAuthServerMetadata();
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    expect(meta.grant_types_supported).toEqual(['authorization_code']);
    expect(meta.token_endpoint_auth_methods_supported).toEqual(['none']);
  });
});
