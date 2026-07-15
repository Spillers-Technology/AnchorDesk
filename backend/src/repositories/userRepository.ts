/**
 * All user DB access. Routes never touch Prisma's user model directly.
 *
 * Local usernames/emails are stored lowercased so lookups are case-insensitive
 * on Postgres (which is case-sensitive by default, unlike the old MariaDB
 * collation). passwordHash is never returned by the list/serialize helpers.
 */
import { AuthProvider, Prisma, User, UserRole } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { config } from '../config/config';

/** Whether an SSO identity's email is in the AUTH_ADMIN_EMAILS allowlist. */
function isAllowlistedAdmin(email?: string | null): boolean {
  return !!email && config.adminEmails.includes(email.trim().toLowerCase());
}

/** Shape safe to send to clients — never includes secrets (password/TOTP). */
export type PublicUser = Omit<User, 'passwordHash' | 'totpSecret' | 'totpRecovery'> & {
  hasPassword: boolean;
  mfaEnabled: boolean;
};

export function toPublic(u: User): PublicUser {
  const { passwordHash, totpSecret, totpRecovery, ...rest } = u;
  return { ...rest, hasPassword: !!passwordHash, mfaEnabled: u.totpEnabled };
}

export function list(): Promise<User[]> {
  return prisma.user.findMany({ orderBy: { username: 'asc' } });
}

export function findById(id: number): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

/** Local accounts only — keyed on the lowercased username. */
export function findLocalByUsername(username: string): Promise<User | null> {
  return prisma.user.findFirst({
    where: { username: username.trim().toLowerCase(), authProvider: 'local' },
  });
}

export async function count(): Promise<number> {
  return prisma.user.count();
}

export interface CreateLocalInput {
  username: string;
  passwordHash: string;
  displayName?: string;
  email?: string;
  role?: UserRole;
}

export async function createLocal(input: CreateLocalInput, actor: string): Promise<User> {
  const user = await prisma.user.create({
    data: {
      authProvider: 'local',
      username: input.username.trim().toLowerCase(),
      passwordHash: input.passwordHash,
      passwordChangedAt: new Date(),
      displayName: input.displayName?.trim() || input.username,
      email: input.email?.trim().toLowerCase() || null,
      role: input.role ?? 'technician',
    },
  });
  await audit.record({
    entityType: 'user',
    entityId: user.id,
    action: 'create',
    changedBy: actor,
    newValue: { username: user.username, role: user.role, authProvider: 'local' },
  });
  return user;
}

/**
 * Upsert an SSO identity (OIDC or SAML). Keyed on (authProvider, subject) so
 * the same person across providers stays distinct and a renamed username never
 * forks the account. Role/isActive are NOT overwritten on update — admins own
 * those locally even when the IdP is the identity source — with one exception:
 * an email in the AUTH_ADMIN_EMAILS allowlist is promoted to admin on every
 * login (promotion-only; a non-listed user is never demoted here).
 */
export async function upsertSso(opts: {
  provider: AuthProvider;
  subject: string;
  username: string;
  displayName?: string | null;
  email?: string | null;
  defaultRole?: UserRole;
}): Promise<User> {
  const forceAdmin = isAllowlistedAdmin(opts.email);
  return prisma.user.upsert({
    where: { authProvider_subject: { authProvider: opts.provider, subject: opts.subject } },
    update: {
      username: opts.username.trim().toLowerCase(),
      displayName: opts.displayName ?? undefined,
      email: opts.email?.trim().toLowerCase() ?? undefined,
      // Promote allowlisted admins; leave everyone else's role untouched.
      role: forceAdmin ? 'admin' : undefined,
      lastSeenAt: new Date(),
    },
    create: {
      authProvider: opts.provider,
      subject: opts.subject,
      username: opts.username.trim().toLowerCase(),
      displayName: opts.displayName ?? opts.username,
      email: opts.email?.trim().toLowerCase() ?? null,
      role: forceAdmin ? 'admin' : opts.defaultRole ?? 'technician',
      lastSeenAt: new Date(),
    },
  });
}

export interface UpdateUserInput {
  displayName?: string;
  email?: string;
  role?: UserRole;
  isActive?: boolean;
}

export async function update(id: number, input: UpdateUserInput, actor: string): Promise<User> {
  const before = await prisma.user.findUnique({ where: { id } });
  const data: Prisma.UserUpdateInput = {};
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.email !== undefined) data.email = input.email.trim().toLowerCase() || null;
  if (input.role !== undefined) data.role = input.role;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const user = await prisma.user.update({ where: { id }, data });

  // Deactivating a user kills their live sessions immediately.
  if (input.isActive === false) {
    await prisma.session.deleteMany({ where: { userId: id } });
  }

  await audit.record({
    entityType: 'user',
    entityId: id,
    action: 'update',
    changedBy: actor,
    oldValue: before ? { role: before.role, isActive: before.isActive } : null,
    newValue: { role: user.role, isActive: user.isActive },
  });
  return user;
}

export async function setPassword(id: number, passwordHash: string, actor: string): Promise<User> {
  const user = await prisma.user.update({
    where: { id },
    data: { passwordHash, passwordChangedAt: new Date() },
  });
  // Force re-login everywhere after a password change.
  await prisma.session.deleteMany({ where: { userId: id } });
  await audit.record({
    entityType: 'user',
    entityId: id,
    action: 'update',
    changedBy: actor,
    newValue: { passwordChanged: true },
  });
  return user;
}

export async function remove(id: number, actor: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return null;
  await prisma.user.delete({ where: { id } });
  await audit.record({
    entityType: 'user',
    entityId: id,
    action: 'delete',
    changedBy: actor,
    oldValue: { username: user.username, role: user.role },
  });
  return user;
}

/** Count active admins — used to block removing/demoting the last admin. */
export function countActiveAdmins(): Promise<number> {
  return prisma.user.count({ where: { role: 'admin', isActive: true } });
}

/** Update a user's own email signature (sanitized HTML, set by the caller). */
export function setSignature(id: number, signatureHtml: string | null): Promise<User> {
  return prisma.user.update({ where: { id }, data: { signatureHtml } });
}

/** Update a user's own UI theme preference (a palette id, validated by the caller). */
export function setThemePref(id: number, themePref: string | null): Promise<User> {
  return prisma.user.update({ where: { id }, data: { themePref } });
}

/** Update a user's own Kanban column selection (validated by the caller; null = default). */
export function setKanbanColumns(id: number, kanbanColumns: string[] | null): Promise<User> {
  return prisma.user.update({
    where: { id },
    data: { kanbanColumns: kanbanColumns ?? Prisma.DbNull },
  });
}

/** Active users who can own a ticket (admins + technicians). For the assignee picker. */
export function listAssignable(): Promise<User[]> {
  return prisma.user.findMany({
    where: { isActive: true, role: { in: ['admin', 'technician'] } },
    orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
  });
}

// ─── TOTP / MFA ────────────────────────────────────────────────────────────

/** Stage a candidate TOTP secret (not yet active — totpEnabled stays false). */
export function stageTotpSecret(id: number, secret: string): Promise<User> {
  return prisma.user.update({
    where: { id },
    data: { totpSecret: secret, totpEnabled: false, totpRecovery: Prisma.JsonNull },
  });
}

/** Activate TOTP after a code is verified; store recovery-code hashes. */
export async function enableTotp(id: number, recoveryHashes: string[], actor: string): Promise<User> {
  const user = await prisma.user.update({
    where: { id },
    data: { totpEnabled: true, totpRecovery: recoveryHashes },
  });
  await audit.record({ entityType: 'user', entityId: id, action: 'update', changedBy: actor, newValue: { mfaEnabled: true } });
  return user;
}

export async function disableTotp(id: number, actor: string): Promise<User> {
  const user = await prisma.user.update({
    where: { id },
    data: { totpEnabled: false, totpSecret: null, totpRecovery: Prisma.JsonNull },
  });
  await audit.record({ entityType: 'user', entityId: id, action: 'update', changedBy: actor, newValue: { mfaEnabled: false } });
  return user;
}

/** Consume a recovery code if it matches; returns true and removes it on success. */
export async function consumeRecoveryCode(id: number, codeHash: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id } });
  const hashes = Array.isArray(user?.totpRecovery) ? (user!.totpRecovery as string[]) : [];
  if (!hashes.includes(codeHash)) return false;
  await prisma.user.update({
    where: { id },
    data: { totpRecovery: hashes.filter((h) => h !== codeHash) },
  });
  return true;
}
