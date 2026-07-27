/**
 * Server-side sessions.
 *
 * The browser holds an opaque 256-bit random token in an httpOnly cookie. We
 * store only its SHA-256 hash, so the sessions table is useless to an attacker
 * who reads the DB. Lookups hash the presented token and match by hash.
 *
 * Server-side sessions (vs JWTs) give us instant revocation: deleting the row —
 * on logout, password change, or account deactivation — kills the session now.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { User } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { config } from '../../config/config';
import type { RequesterPrincipal } from '../../types/principal';

export const SESSION_COOKIE = 'mt_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const PORTAL_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

function cookieOptions(ttlMs: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.appBaseUrl.startsWith('https://'),
    path: '/',
    maxAge: ttlMs / 1000,
  };
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  ttlMs = SESSION_TTL_MS,
): void {
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(ttlMs));
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Create a session row + set the cookie. Returns the issued user. */
export async function createSession(reply: FastifyReply, req: FastifyRequest, user: User): Promise<void> {
  const token = generateSessionToken();
  await prisma.session.create({
    data: {
      scope: 'staff',
      userId: user.id,
      contactId: null,
      tokenHash: hashSessionToken(token),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 255) || null,
      ip: req.ip,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  setSessionCookie(reply, token);
}

export type ResolvedScopedSession =
  | { kind: 'staff'; user: User }
  | RequesterPrincipal;

/**
 * Resolve either supported session principal.
 *
 * The branch checks are deliberately positive and repeat the database CHECK:
 * a corrupt/legacy row with both principals, neither principal, or a
 * scope/principal mismatch authenticates nobody.
 */
export async function resolveScopedSession(
  token: string | undefined,
): Promise<ResolvedScopedSession | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true, contact: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  if (
    session.scope === 'staff' &&
    session.userId !== null &&
    session.contactId === null &&
    session.user &&
    !session.contact
  ) {
    if (!session.user.isActive) return null;
    return { kind: 'staff', user: session.user };
  }

  if (
    session.scope === 'portal' &&
    session.userId === null &&
    session.contactId !== null &&
    !session.user &&
    session.contact &&
    typeof session.contact.email === 'string' &&
    session.contact.email.trim()
  ) {
    return {
      kind: 'requester',
      contactId: session.contact.id,
      companyId: session.contact.companyId,
      name: session.contact.name,
      email: session.contact.email,
    };
  }

  // A row outside the allowlisted shapes is not merely unusable; deleting it
  // prevents every later request from re-evaluating corrupt auth state.
  await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
  return null;
}

/**
 * Staff-only compatibility resolver for MFA and MCP OAuth consent.
 *
 * Keeping this name staff-only is intentional: existing callers cannot begin
 * accepting a Contact merely because the Session table became polymorphic.
 */
export async function resolveSession(token: string | undefined): Promise<User | null> {
  const principal = await resolveScopedSession(token);
  return principal?.kind === 'staff' ? principal.user : null;
}

/** Destroy the current session (logout) and clear the cookie. */
export async function destroySession(reply: FastifyReply, token: string | undefined): Promise<void> {
  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashSessionToken(token) } })
      .catch(() => {});
  }
  clearSessionCookie(reply);
}

/** Best-effort sweep of expired sessions; call on an interval. */
export async function pruneExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}

// Constant-time compare helper (exported for reuse; e.g. probe key checks).
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
