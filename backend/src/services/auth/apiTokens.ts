/**
 * Personal access tokens (PATs).
 *
 * A PAT lets a programmatic client that can't do an interactive/OIDC login —
 * the MCP voice agent being the motivating case — authenticate AS a real user.
 * The raw token is shown to the user exactly once at creation; we persist only
 * its SHA-256 hash (same model as Session), so a DB read never yields a usable
 * credential. Resolution hashes the presented token and matches by hash.
 *
 * The token carries the owner's identity and role, so existing RBAC applies
 * unchanged. Audit attribution stays the real user, tagged with the channel the
 * action came through (see middleware/auth.ts) so "act as themselves" holds.
 */
import { createHash, randomBytes } from 'crypto';
import { ApiToken, ApiTokenScope, User } from '@prisma/client';
import { prisma } from '../../db/prisma';
import * as audit from '../../repositories/auditRepository';

// Distinguishes our PATs from OIDC access tokens on the same Bearer scheme, and
// gives users a recognizable, greppable prefix.
export const TOKEN_PREFIX = 'adk_';

/** Hex SHA-256 of a raw token — the only form we persist. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** True if a Bearer value looks like one of our PATs (vs an OIDC access token). */
export function isPatFormat(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX);
}

/**
 * Mint a fresh raw token + its display prefix. Pure (no DB) so the format and
 * uniqueness are unit-testable; callers persist `hashToken(raw)`.
 */
export function generateRawToken(): { raw: string; prefix: string } {
  const raw = TOKEN_PREFIX + randomBytes(32).toString('hex');
  return { raw, prefix: raw.slice(0, 12) };
}

/** Shape safe to send to clients — never includes the hash. */
export type PublicApiToken = Omit<ApiToken, 'tokenHash'>;

export function toPublic(t: ApiToken): PublicApiToken {
  const { tokenHash, ...rest } = t;
  return rest;
}

/**
 * Mint a token for a user. Returns the public row plus the one-time raw token
 * (the only moment it exists in plaintext). `expiresInDays` is optional — omit
 * for a non-expiring token.
 */
export async function create(
  userId: number,
  name: string,
  actor: string,
  expiresInDays?: number,
  scope: ApiTokenScope = 'full',
): Promise<{ token: PublicApiToken; secret: string }> {
  const { raw, prefix } = generateRawToken();
  const expiresAt =
    expiresInDays && expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  const row = await prisma.apiToken.create({
    data: { userId, name: name.trim().slice(0, 150) || 'token', tokenHash: hashToken(raw), prefix, expiresAt, scope },
  });
  await audit.record({
    entityType: 'api_token',
    entityId: row.id,
    action: 'create',
    changedBy: actor,
    newValue: { name: row.name, prefix: row.prefix, expiresAt: row.expiresAt, scope: row.scope },
  });
  return { token: toPublic(row), secret: raw };
}

/** A user's tokens, newest first (never includes the hash). */
export async function listForUser(userId: number): Promise<PublicApiToken[]> {
  const rows = await prisma.apiToken.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  return rows.map(toPublic);
}

/**
 * Resolve a presented raw token to its (active) owning user and the token's
 * scope, or null. Rejects revoked/expired tokens and inactive users. Stamps
 * lastUsedAt best-effort so a write failure never blocks auth.
 */
export async function resolve(token: string): Promise<{ user: User; scope: ApiTokenScope } | null> {
  if (!isPatFormat(token)) return null;
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  if (!row.user.isActive) return null;

  prisma.apiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { user: row.user, scope: row.scope };
}

/**
 * Revoke a token. Owners revoke their own; admins may revoke any. Returns false
 * if the token doesn't exist or the caller isn't permitted to touch it.
 */
export async function revoke(
  id: number,
  caller: { id: number; role: string; username: string },
): Promise<boolean> {
  const row = await prisma.apiToken.findUnique({ where: { id } });
  if (!row) return false;
  if (row.userId !== caller.id && caller.role !== 'admin') return false;
  if (row.revokedAt) return true; // already revoked — idempotent

  await prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit.record({
    entityType: 'api_token',
    entityId: id,
    action: 'delete',
    changedBy: caller.username,
    oldValue: { name: row.name, prefix: row.prefix, userId: row.userId },
  });
  return true;
}
