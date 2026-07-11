/**
 * Unified authentication + RBAC for Fastify.
 *
 * Two credential types are accepted, in order:
 *   1. Session cookie  — interactive login (local / OIDC / SAML) → server-side
 *      session row. This is the primary browser path.
 *   2. Bearer token    — OIDC access token, for programmatic API clients. The
 *      token is validated against the configured IdP (introspection → userinfo)
 *      and the identity upserted as an SSO user.
 *
 * Exempt paths: /ping, /probe/* (probe API-key auth), and the public /auth/*
 * login endpoints. Everything else requires an active user.
 *
 * RBAC: every authenticated request carries a role. A baseline rule denies
 * mutations (non-GET) to `readonly` users; admin-only surfaces add an explicit
 * requireRole('admin') preHandler.
 *
 * OIDC_DISABLED=true bypasses all of this for local dev (every request = admin).
 */
import { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import * as oidc from 'openid-client';
import { UserRole } from '@prisma/client';
import { config } from '../config/config';
import { resolveSession, SESSION_COOKIE } from '../services/auth/sessions';
import { getAuthSettings } from '../services/auth/authConfig';
import * as userRepo from '../repositories/userRepository';
import * as apiTokens from '../services/auth/apiTokens';
import { isPublic } from './publicPaths';
import { mcpWwwAuthenticateHeader } from '../services/auth/mcpOAuth';

export { isPublic };

export interface AuthUser {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  role: UserRole;
  authProvider: string;
  themePref: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
    // Stable actor string for the audit log. Plain username for interactive
    // logins; suffixed with the channel (e.g. "alice (api)") for token clients
    // so mutations stay attributed to the real user while showing how they came in.
    actorSub: string;
    // How this request authenticated: 'web' (session/OIDC) or 'api' (personal token).
    authChannel: AuthChannel;
  }
}

export type AuthChannel = 'web' | 'api' | 'mcp';

/** Audit actor string: the user, tagged with the channel for non-web access. */
export function actorFor(username: string, channel: AuthChannel): string {
  return channel === 'web' ? username : `${username} (${channel})`;
}

const DEV_ADMIN: AuthUser = {
  id: 0,
  username: 'dev',
  displayName: 'Dev User',
  email: null,
  role: 'admin',
  authProvider: 'local',
  themePref: null,
};

// ─── Bearer (OIDC access token) validation, for API clients ──────────────────

let bearerConfig: { key: string; cfg: oidc.Configuration } | null = null;

async function getBearerConfig(): Promise<oidc.Configuration | null> {
  const s = await getAuthSettings();
  if (!s.oidcEnabled || !s.oidcIssuerUrl || !s.oidcClientId) return null;
  const key = `${s.oidcIssuerUrl}|${s.oidcClientId}`;
  if (bearerConfig?.key === key) return bearerConfig.cfg;
  const auth = s.oidcClientSecret ? oidc.ClientSecretPost(s.oidcClientSecret) : oidc.None();
  const cfg = await oidc.discovery(new URL(s.oidcIssuerUrl), s.oidcClientId, undefined, auth);
  bearerConfig = { key, cfg };
  return cfg;
}

async function resolveBearer(token: string): Promise<AuthUser | null> {
  const cfg = await getBearerConfig();
  if (!cfg) return null;

  let claims: Record<string, unknown> | null = null;
  try {
    const introspected = await oidc.tokenIntrospection(cfg, token);
    if (introspected.active) claims = introspected as Record<string, unknown>;
  } catch {
    /* fall through to userinfo */
  }
  if (!claims) {
    const userinfo = await oidc.fetchUserInfo(cfg, token, oidc.skipSubjectCheck);
    claims = userinfo as unknown as Record<string, unknown>;
  }
  if (!claims?.sub) return null;

  const user = await userRepo.upsertSso({
    provider: 'oidc',
    subject: String(claims.sub),
    username: String(claims.preferred_username ?? claims.email ?? claims.sub),
    displayName: typeof claims.name === 'string' ? claims.name : null,
    email: typeof claims.email === 'string' ? claims.email : null,
  });
  if (!user.isActive) return null;
  return toAuthUser(user);
}

function toAuthUser(u: {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  role: UserRole;
  authProvider: string;
  themePref?: string | null;
}): AuthUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    role: u.role,
    authProvider: u.authProvider,
    themePref: u.themePref ?? null,
  };
}

function isMcpRequest(url: string): boolean {
  return url.split('?')[0].startsWith('/mcp/');
}

function unauthorized(request: FastifyRequest, reply: FastifyReply) {
  if (isMcpRequest(request.url)) {
    reply.header('WWW-Authenticate', mcpWwwAuthenticateHeader());
  }
  return reply.status(401).send({ error: 'Authentication required' });
}

export async function registerAuthHook(server: FastifyInstance) {
  if (config.oidcDisabled) {
    server.log.warn('OIDC_DISABLED=true — all requests run as the dev admin user');
    server.addHook('onRequest', async (request: FastifyRequest) => {
      request.user = DEV_ADMIN;
      request.actorSub = 'system';
      request.authChannel = 'web';
    });
    return;
  }

  server.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPublic(request.url)) return;

    // 1. Session cookie (primary browser path).
    const sessionToken = request.cookies?.[SESSION_COOKIE];
    if (sessionToken) {
      const user = await resolveSession(sessionToken);
      if (user) {
        request.user = toAuthUser(user);
        request.actorSub = user.username;
        request.authChannel = 'web';
        return enforceBaseline(request, reply);
      }
    }

    // 2. Bearer token. Two kinds share the scheme: our personal access tokens
    //    (prefix-tagged, resolved locally) and OIDC access tokens (validated
    //    against the IdP). PATs are the cheaper, offline check, so try first.
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const bearer = authHeader.slice(7);

      if (apiTokens.isPatFormat(bearer)) {
        const user = await apiTokens.resolve(bearer);
        if (user) {
          request.user = toAuthUser(user);
          request.actorSub = actorFor(user.username, 'api');
          request.authChannel = 'api';
          return enforceBaseline(request, reply);
        }
        // A malformed/revoked PAT is never a valid OIDC token — fail fast.
        return unauthorized(request, reply);
      }

      try {
        const user = await resolveBearer(bearer);
        if (user) {
          request.user = user;
          request.actorSub = actorFor(user.username, 'api');
          request.authChannel = 'api';
          return enforceBaseline(request, reply);
        }
      } catch (err) {
        request.log.warn({ err }, 'Bearer auth failed');
      }
    }

    return unauthorized(request, reply);
  });
}

// Baseline RBAC: readonly users may only read.
function enforceBaseline(request: FastifyRequest, reply: FastifyReply) {
  const method = request.method.toUpperCase();
  const isWrite = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  if (isWrite && request.user.role === 'readonly') {
    return reply.status(403).send({ error: 'Read-only role cannot modify data' });
  }
}

/** preHandler factory: require one of the given roles (e.g. admin-only routes). */
export function requireRole(...roles: UserRole[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return reply.status(401).send({ error: 'Authentication required' });
    if (!roles.includes(request.user.role)) {
      return reply.status(403).send({ error: `Requires role: ${roles.join(' or ')}` });
    }
  };
}
