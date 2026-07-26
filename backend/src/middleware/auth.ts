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
import { resolveScopedSession, SESSION_COOKIE } from '../services/auth/sessions';
import { getAuthSettings } from '../services/auth/authConfig';
import * as userRepo from '../repositories/userRepository';
import * as apiTokens from '../services/auth/apiTokens';
import { isPortalSessionAllowed, isPublic } from './publicPaths';
import { mcpWwwAuthenticateHeader } from '../services/auth/mcpOAuth';
import type { RequesterPrincipal } from '../types/principal';

export { isPublic };

export interface AuthUser {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  role: UserRole;
  authProvider: string;
  themePref: string | null;
  /** Ordered Kanban board statuses to show; null = all statuses. */
  kanbanColumns: string[] | null;
}

export interface StaffPrincipal {
  kind: 'staff';
  user: AuthUser;
}

export type RequestPrincipal = StaffPrincipal | RequesterPrincipal;

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
    // Neutral discriminated identity. Requester principals never acquire a
    // staff User shape or role; legacy staff routes continue using `user`.
    principal: RequestPrincipal;
    // Stable actor string for the audit log. Plain username for interactive
    // logins; suffixed with the channel (e.g. "alice (api)") for token clients
    // so mutations stay attributed to the real user while showing how they came in.
    actorSub: string;
    // How this request authenticated: 'web' (session/OIDC) or 'api' (personal token).
    authChannel: AuthChannel;
  }
}

export type AuthChannel = 'web' | 'api' | 'mcp' | 'portal';

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
  kanbanColumns: null,
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
  kanbanColumns?: unknown;
}): AuthUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    role: u.role,
    authProvider: u.authProvider,
    themePref: u.themePref ?? null,
    kanbanColumns: Array.isArray(u.kanbanColumns)
      ? u.kanbanColumns.filter((value): value is string => typeof value === 'string')
      : null,
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

function applyRequesterSession(
  request: FastifyRequest,
  reply: FastifyReply,
  principal: RequesterPrincipal,
) {
  request.principal = principal;
  request.actorSub = actorFor(
    `requester:${principal.contactId}`,
    'portal',
  );
  request.authChannel = 'portal';
  if (!isPortalSessionAllowed(request.method, request.url)) {
    return reply.status(403).send({
      error: 'Portal session is not permitted for this route',
    });
  }
}

export async function registerAuthHook(server: FastifyInstance) {
  if (config.oidcDisabled) {
    server.log.warn('OIDC_DISABLED=true — all requests run as the dev admin user');
    server.addHook('onRequest', async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      // Portal login must remain exercisable in local development. Once the
      // browser has a valid requester cookie, preserve that narrower principal
      // and its allowlist instead of overwriting it with DEV_ADMIN. Resolve that
      // cookie even on otherwise-public staff routes: public-to-anonymous must
      // not become a way for an authenticated requester to escape the positive
      // route allowlist.
      const sessionToken = request.cookies?.[SESSION_COOKIE];
      if (sessionToken) {
        const principal = await resolveScopedSession(sessionToken);
        if (principal?.kind === 'requester') {
          return applyRequesterSession(request, reply, principal);
        }
      }
      request.user = DEV_ADMIN;
      request.principal = { kind: 'staff', user: DEV_ADMIN };
      request.actorSub = 'system';
      request.authChannel = 'web';
    });
    return;
  }

  server.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Session cookie (primary browser path). Resolve a valid requester
    // cookie before the public-path bypass: otherwise a portal principal could
    // invoke public staff-auth mutations such as /auth/logout outside its
    // positive allowlist. Invalid/expired cookies still reach public routes as
    // anonymous requests.
    const sessionToken = request.cookies?.[SESSION_COOKIE];
    const sessionPrincipal = sessionToken
      ? await resolveScopedSession(sessionToken)
      : null;
    if (sessionPrincipal?.kind === 'requester') {
      return applyRequesterSession(request, reply, sessionPrincipal);
    }

    if (isPublic(request.url, request.method)) return;

    if (sessionToken) {
      if (sessionPrincipal?.kind === 'staff') {
        const user = toAuthUser(sessionPrincipal.user);
        request.user = user;
        request.principal = { kind: 'staff', user };
        request.actorSub = sessionPrincipal.user.username;
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
          request.principal = { kind: 'staff', user: request.user };
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
          request.principal = { kind: 'staff', user };
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
