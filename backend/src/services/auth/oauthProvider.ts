/**
 * A minimal OAuth 2.0 authorization server, scoped to MCP.
 *
 * MCP clients (ChatGPT's connector being the motivating case) discover this via
 * the protected-resource metadata (see mcpOAuth.ts), then run the standard
 * authorization-code + PKCE flow against *us* rather than an external IdP. We are
 * both the resource server and the authorization server, which is what these
 * clients expect and what avoids depending on the customer's IdP supporting open
 * Dynamic Client Registration.
 *
 * The flow:
 *   1. POST /oauth/register  — Dynamic Client Registration (RFC 7591). Anyone can
 *      register a public client; a client row is inert until a real user approves
 *      it, and PKCE + user consent gate everything downstream.
 *   2. GET  /oauth/authorize — the signed-in user consents; we issue a one-time
 *      code bound to the PKCE challenge, redirect URI, and the approving user.
 *   3. POST /oauth/token     — the client redeems the code (+ PKCE verifier) for
 *      an access token. The token we return is a freshly minted personal access
 *      token (adk_…), so the existing bearer path in middleware/auth.ts validates
 *      it offline with no new code, and RBAC/audit attribute to the real user.
 *
 * This file is the pure/data layer (DCR, PKCE, code issue/redeem, metadata,
 * consent HTML). The HTTP wiring lives in routes/oauth.ts.
 */
import { createHash, randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { OAuthClient } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { config } from '../../config/config';
import * as apiTokens from './apiTokens';

const AUTHORIZE_PATH = '/oauth/authorize';
const TOKEN_PATH = '/oauth/token';
const REGISTER_PATH = '/oauth/register';
export const AUTH_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server';

// Authorization codes are single-use and short-lived. 5 minutes leaves room for a
// slow consent step without keeping a redeemable code around long.
const CODE_TTL_MS = 5 * 60 * 1000;

// The one scope we grant. MCP clients treat scope as opaque; this just names the
// access on the consent screen and in metadata.
export const MCP_SCOPE = 'mcp';

function publicUrl(path: string): string {
  return `${config.appBaseUrl}${path}`;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function base64UrlSha256(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

// ─── Authorization Server Metadata (RFC 8414) ────────────────────────────────

export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  scopes_supported: string[];
}

export function buildAuthServerMetadata(): AuthServerMetadata {
  return {
    issuer: config.appBaseUrl,
    authorization_endpoint: publicUrl(AUTHORIZE_PATH),
    token_endpoint: publicUrl(TOKEN_PATH),
    registration_endpoint: publicUrl(REGISTER_PATH),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [MCP_SCOPE],
  };
}

// ─── Dynamic Client Registration (RFC 7591) ──────────────────────────────────

export interface RegistrationRequest {
  redirect_uris?: unknown;
  client_name?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  scope?: unknown;
  token_endpoint_auth_method?: unknown;
}

export interface RegistrationResult {
  client_id: string;
  client_id_issued_at: number;
  redirect_uris: string[];
  client_name?: string;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none';
  scope: string;
}

export class OAuthError extends Error {
  constructor(
    public code: string,
    public description: string,
    public status = 400,
  ) {
    super(description);
  }
}

/**
 * A redirect URI is only acceptable over https, or on loopback for local dev.
 * This is the client's sole trust anchor (there's no client secret), so we won't
 * hand out codes to a plaintext or arbitrary-scheme endpoint.
 */
function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
    return true;
  }
  return false;
}

export async function registerClient(body: RegistrationRequest): Promise<RegistrationResult> {
  const rawUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const redirectUris = rawUris.filter((u): u is string => typeof u === 'string' && u.length > 0);

  if (redirectUris.length === 0) {
    throw new OAuthError('invalid_redirect_uri', 'At least one redirect_uri is required');
  }
  if (redirectUris.length > 10) {
    throw new OAuthError('invalid_redirect_uri', 'Too many redirect URIs');
  }
  for (const uri of redirectUris) {
    if (!isAllowedRedirectUri(uri)) {
      throw new OAuthError('invalid_redirect_uri', `redirect_uri must be https (or http on localhost): ${uri}`);
    }
  }

  const clientName =
    typeof body.client_name === 'string' ? body.client_name.slice(0, 255) : undefined;
  // We only support the authorization-code grant for public clients; ignore any
  // other requested grants rather than rejecting a well-meaning registration.
  const grantTypes = ['authorization_code'];
  const responseTypes = ['code'];

  const clientId = `adkc_${randomBytes(24).toString('hex')}`;
  await prisma.oAuthClient.create({
    data: {
      clientId,
      clientName,
      redirectUris,
      grantTypes,
      scope: MCP_SCOPE,
    },
  });

  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    client_name: clientName,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: 'none',
    scope: MCP_SCOPE,
  };
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId) return null;
  return prisma.oAuthClient.findUnique({ where: { clientId } });
}

export function clientRedirectUris(client: OAuthClient): string[] {
  const uris = client.redirectUris;
  return Array.isArray(uris) ? (uris.filter((u) => typeof u === 'string') as string[]) : [];
}

// ─── Authorization request validation + code issuance ────────────────────────

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
  resource?: string;
}

export interface ValidatedAuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state?: string;
  resource?: string;
}

/**
 * Validate an /authorize request. Errors that can't be safely redirected (bad
 * client, bad redirect_uri) throw an OAuthError to render directly; everything
 * else the caller redirects back to the client per RFC 6749 §4.1.2.1.
 */
export async function validateAuthorizeRequest(
  params: AuthorizeParams,
): Promise<ValidatedAuthorizeRequest> {
  const client = await getClient(params.client_id ?? '');
  if (!client) {
    throw new OAuthError('invalid_client', 'Unknown client_id');
  }

  const registered = clientRedirectUris(client);
  const redirectUri = params.redirect_uri ?? '';
  if (!redirectUri || !registered.includes(redirectUri)) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uri does not match a registered URI');
  }

  // Past this point errors are redirectable, but we still throw and let the route
  // decide; these are developer-facing (a spec-conformant client won't hit them).
  if (params.response_type !== 'code') {
    throw new RedirectableOAuthError(redirectUri, 'unsupported_response_type', 'Only response_type=code is supported', params.state);
  }
  if (!params.code_challenge || params.code_challenge_method !== 'S256') {
    throw new RedirectableOAuthError(redirectUri, 'invalid_request', 'PKCE with code_challenge_method=S256 is required', params.state);
  }

  return {
    client,
    redirectUri,
    codeChallenge: params.code_challenge,
    scope: MCP_SCOPE,
    state: params.state,
    resource: params.resource,
  };
}

/** An OAuth error that should be delivered by redirecting back to the client. */
export class RedirectableOAuthError extends Error {
  constructor(
    public redirectUri: string,
    public code: string,
    public description: string,
    public state?: string,
  ) {
    super(description);
  }
}

/** Build a redirect URL carrying an OAuth error back to the client. */
export function errorRedirect(redirectUri: string, code: string, state?: string, description?: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', code);
  if (description) url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

/** Issue a single-use auth code for an approved request; returns the redirect URL. */
export async function issueCode(
  req: ValidatedAuthorizeRequest,
  userId: number,
): Promise<string> {
  const code = randomBytes(32).toString('hex');
  await prisma.oAuthAuthCode.create({
    data: {
      codeHash: sha256Hex(code),
      clientId: req.client.clientId,
      userId,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      scope: req.scope,
      resource: req.resource ?? null,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  const url = new URL(req.redirectUri);
  url.searchParams.set('code', code);
  if (req.state) url.searchParams.set('state', req.state);
  return url.toString();
}

// ─── Token exchange ──────────────────────────────────────────────────────────

export interface TokenRequest {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  code_verifier?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  scope: string;
}

/**
 * Redeem an authorization code for an access token. The token is a personal
 * access token minted for the code's owning user, so downstream auth is unchanged.
 * Verifies grant type, PKCE, client, and redirect_uri, and consumes the code once.
 */
export async function exchangeCode(body: TokenRequest): Promise<TokenResponse> {
  if (body.grant_type !== 'authorization_code') {
    throw new OAuthError('unsupported_grant_type', 'Only grant_type=authorization_code is supported');
  }
  if (!body.code || !body.code_verifier || !body.redirect_uri || !body.client_id) {
    throw new OAuthError('invalid_request', 'code, code_verifier, redirect_uri, and client_id are required');
  }

  const row = await prisma.oAuthAuthCode.findUnique({ where: { codeHash: sha256Hex(body.code) } });
  if (!row) {
    throw new OAuthError('invalid_grant', 'Unknown or expired authorization code');
  }

  // Consume-or-reject up front so a code can never be redeemed twice, even under a
  // race: the conditional update only succeeds while usedAt is still null.
  const consumed = await prisma.oAuthAuthCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count === 0) {
    throw new OAuthError('invalid_grant', 'Authorization code already used');
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw new OAuthError('invalid_grant', 'Authorization code expired');
  }
  if (row.clientId !== body.client_id) {
    throw new OAuthError('invalid_grant', 'client_id does not match the authorization code');
  }
  if (row.redirectUri !== body.redirect_uri) {
    throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request');
  }

  // PKCE: the verifier the client now presents must hash to the challenge it
  // committed to at /authorize.
  const expected = row.codeChallenge;
  const actual = base64UrlSha256(body.code_verifier);
  if (!safeStrEqual(expected, actual)) {
    throw new OAuthError('invalid_grant', 'PKCE verification failed');
  }

  const clientRow = await getClient(row.clientId);
  const tokenName = `${clientRow?.clientName || 'OAuth client'} (MCP)`;
  const { secret } = await apiTokens.create(row.userId, tokenName, `${await usernameFor(row.userId)} (mcp)`);

  return { access_token: secret, token_type: 'Bearer', scope: row.scope ?? MCP_SCOPE };
}

async function usernameFor(userId: number): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  return user?.username ?? 'unknown';
}

// ─── CSRF token for the consent form ─────────────────────────────────────────

/**
 * A CSRF token binding the consent form to the current session. Deterministic
 * (HMAC of the session token under the app secret) so it needs no storage, and
 * unforgeable without the httpOnly session cookie. Belt-and-suspenders on top of
 * the SameSite=lax session cookie, which already blocks cross-site POSTs.
 */
export function consentCsrfToken(sessionToken: string): string {
  return createHmac('sha256', config.sessionSecret).update(`consent:${sessionToken}`).digest('hex');
}

export function verifyConsentCsrf(sessionToken: string, presented: string): boolean {
  return safeStrEqual(consentCsrfToken(sessionToken), presented);
}

function safeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ─── Maintenance ─────────────────────────────────────────────────────────────

/** Best-effort sweep of expired/used auth codes; call on an interval. */
export async function pruneExpiredCodes(): Promise<number> {
  const { count } = await prisma.oAuthAuthCode.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
