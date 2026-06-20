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

export const SESSION_COOKIE = 'mt_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.appBaseUrl.startsWith('https://'),
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  };
}

/** Create a session row + set the cookie. Returns the issued user. */
export async function createSession(reply: FastifyReply, req: FastifyRequest, user: User): Promise<void> {
  const token = randomBytes(32).toString('hex');
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 255) || null,
      ip: req.ip,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  reply.setCookie(SESSION_COOKIE, token, cookieOptions());
}

/** Resolve a session cookie to its (active) user, or null. Lazily prunes expiry. */
export async function resolveSession(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (!session.user.isActive) return null;
  return session.user;
}

/** Destroy the current session (logout) and clear the cookie. */
export async function destroySession(reply: FastifyReply, token: string | undefined): Promise<void> {
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } }).catch(() => {});
  }
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
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
