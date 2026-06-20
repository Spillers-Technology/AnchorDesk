/**
 * OIDC authorization-code login (browser SSO).
 *
 * Distinct from the legacy bearer-token path in middleware/auth.ts: this drives
 * the interactive login — redirect the browser to the IdP, handle the callback,
 * validate the code (PKCE + state + nonce), and mint a local session.
 *
 * Config is read from the effective AuthSetting (env-seeded, DB-authoritative),
 * so an admin can point this at a different IdP without redeploying.
 */
import * as oidc from 'openid-client';
import { AuthSetting } from '@prisma/client';
import { getAuthSettings, oidcRedirectUri } from './authConfig';

export interface OidcStart {
  url: string;
  // Opaque transaction material to round-trip via a signed cookie.
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface OidcResult {
  subject: string;
  username: string;
  displayName?: string;
  email?: string;
}

// Configuration is cached per (issuer, clientId); reset() drops it after edits.
let configCache: { key: string; cfg: oidc.Configuration } | null = null;

async function discover(s: AuthSetting): Promise<oidc.Configuration> {
  if (!s.oidcIssuerUrl || !s.oidcClientId) throw new Error('OIDC is not configured');
  const key = `${s.oidcIssuerUrl}|${s.oidcClientId}`;
  if (configCache?.key === key) return configCache.cfg;

  const auth = s.oidcClientSecret ? oidc.ClientSecretPost(s.oidcClientSecret) : oidc.None();
  const cfg = await oidc.discovery(new URL(s.oidcIssuerUrl), s.oidcClientId, undefined, auth);
  configCache = { key, cfg };
  return cfg;
}

export function resetOidcCache() {
  configCache = null;
}

/** Build the IdP authorization URL + the checks to verify on callback. */
export async function startLogin(): Promise<OidcStart> {
  const s = await getAuthSettings();
  const cfg = await discover(s);

  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  const url = oidc.buildAuthorizationUrl(cfg, {
    redirect_uri: oidcRedirectUri(s),
    scope: 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  return { url: url.href, state, nonce, codeVerifier };
}

/** Validate the callback and extract the identity. */
export async function completeLogin(
  currentUrl: string,
  checks: { state: string; nonce: string; codeVerifier: string }
): Promise<OidcResult> {
  const s = await getAuthSettings();
  const cfg = await discover(s);

  const tokens = await oidc.authorizationCodeGrant(cfg, new URL(currentUrl), {
    pkceCodeVerifier: checks.codeVerifier,
    expectedState: checks.state,
    expectedNonce: checks.nonce,
  });

  const claims = tokens.claims();
  if (!claims?.sub) throw new Error('OIDC response missing subject');

  const username = String(claims.preferred_username ?? claims.email ?? claims.sub);
  return {
    subject: String(claims.sub),
    username,
    displayName: typeof claims.name === 'string' ? claims.name : undefined,
    email: typeof claims.email === 'string' ? claims.email : undefined,
  };
}
