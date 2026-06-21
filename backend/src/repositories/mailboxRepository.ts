/**
 * Mailbox DB access for IMAP email-to-ticket. Passwords are encrypted at rest
 * (crypto.ts) and never returned by the public serializer.
 */
import { Mailbox } from '@prisma/client';
import { prisma } from '../db/prisma';
import { encrypt, decrypt } from '../services/crypto';
import * as audit from './auditRepository';

export type PublicMailbox = Omit<Mailbox, 'passwordEnc'> & { hasPassword: boolean };

export function toPublic(m: Mailbox): PublicMailbox {
  const { passwordEnc, ...rest } = m;
  return { ...rest, hasPassword: !!passwordEnc };
}

export function list(): Promise<Mailbox[]> {
  return prisma.mailbox.findMany({ orderBy: { name: 'asc' } });
}

export function enabled(): Promise<Mailbox[]> {
  return prisma.mailbox.findMany({ where: { enabled: true } });
}

export function findById(id: number): Promise<Mailbox | null> {
  return prisma.mailbox.findUnique({ where: { id } });
}

/** Decrypt the stored password for actually connecting. */
export function password(m: Mailbox): string | null {
  return decrypt(m.passwordEnc);
}

export interface CreateMailboxInput {
  name: string;
  host: string;
  port?: number;
  secure?: boolean;
  username: string;
  password?: string;
  folder?: string;
  companyName?: string;
  labelId?: number | null;
  identityId?: number | null;
  enabled?: boolean;
}

export async function create(input: CreateMailboxInput, actor: string): Promise<Mailbox> {
  const mb = await prisma.mailbox.create({
    data: {
      name: input.name,
      host: input.host,
      port: input.port ?? 993,
      secure: input.secure ?? true,
      username: input.username,
      passwordEnc: input.password ? encrypt(input.password) : null,
      folder: input.folder ?? 'INBOX',
      companyName: input.companyName ?? null,
      labelId: input.labelId ?? null,
      identityId: input.identityId ?? null,
      enabled: input.enabled ?? true,
    },
  });
  await audit.record({ entityType: 'mailbox', entityId: mb.id, action: 'create', changedBy: actor, newValue: { name: mb.name, host: mb.host } });
  return mb;
}

export async function update(id: number, input: Partial<CreateMailboxInput>, actor: string): Promise<Mailbox> {
  const data: Record<string, unknown> = {};
  for (const k of ['name', 'host', 'port', 'secure', 'username', 'folder', 'companyName', 'labelId', 'identityId', 'enabled'] as const) {
    if (input[k] !== undefined) data[k] = input[k];
  }
  // Empty password = keep existing.
  if (input.password) data.passwordEnc = encrypt(input.password);

  const mb = await prisma.mailbox.update({ where: { id }, data });
  await audit.record({ entityType: 'mailbox', entityId: id, action: 'update', changedBy: actor, newValue: { name: mb.name } });
  return mb;
}

export async function remove(id: number, actor: string): Promise<Mailbox | null> {
  const mb = await prisma.mailbox.findUnique({ where: { id } });
  if (!mb) return null;
  await prisma.mailbox.delete({ where: { id } });
  await audit.record({ entityType: 'mailbox', entityId: id, action: 'delete', changedBy: actor, oldValue: { name: mb.name } });
  return mb;
}

export function recordPoll(id: number, lastUid: number | undefined, error: string | null): Promise<Mailbox> {
  return prisma.mailbox.update({
    where: { id },
    data: { lastPolledAt: new Date(), lastError: error, ...(lastUid !== undefined ? { lastUid } : {}) },
  });
}
