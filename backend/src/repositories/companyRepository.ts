/**
 * Company + Contact DB access (the CRM layer). All mutations record to the
 * append-only audit log so company/contact changes are attributable.
 */
import { Company, Contact, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import {
  canonicalContactEmail,
  findContactsByNormalizedEmail,
  lockPortalIdentityWrites,
  normalizeContactIdentityEmail,
  revokeContactPortalCredentials,
  revokeIfEmailAmbiguous,
  type ContactIdentityRow,
} from './portalIdentityRepository';

// ─── Companies ───────────────────────────────────────────────────────────────

export function list(): Promise<(Company & { _count: { tickets: number; contacts: number; devices: number } })[]> {
  return prisma.company.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { tickets: true, contacts: true, devices: true } } },
  });
}

export function getById(id: number) {
  return prisma.company.findUnique({
    where: { id },
    include: { contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] } },
  });
}

export function findByName(name: string): Promise<Company | null> {
  return prisma.company.findUnique({ where: { name } });
}

export interface CompanyInput {
  name: string;
  domain?: string;
  phone?: string;
  email?: string | null;
  website?: string;
  address?: string;
  notes?: string;
}

export async function create(input: CompanyInput, actor: string): Promise<Company> {
  const company = await prisma.company.create({ data: { ...input, name: input.name.trim() } });
  await audit.record({ entityType: 'company', entityId: company.id, action: 'create', changedBy: actor, newValue: { name: company.name } });
  return company;
}

/** Find a company by name (case-insensitive) or create it. Used by the picker's
 *  "create new" and by future sync backfill. */
export async function findOrCreateByName(name: string, actor: string): Promise<Company> {
  const trimmed = name.trim();
  const existing = await prisma.company.findFirst({ where: { name: { equals: trimmed, mode: 'insensitive' } } });
  if (existing) return existing;
  return create({ name: trimmed }, actor);
}

export async function update(id: number, input: Partial<CompanyInput>, actor: string): Promise<Company> {
  const company = await prisma.company.update({ where: { id }, data: input as Prisma.CompanyUpdateInput });
  // Keep denormalized ticket/device companyName in sync if the name changed.
  if (input.name) {
    await prisma.ticket.updateMany({ where: { companyId: id }, data: { companyName: company.name } });
    await prisma.device.updateMany({ where: { companyId: id }, data: { companyName: company.name } });
  }
  await audit.record({ entityType: 'company', entityId: id, action: 'update', changedBy: actor, newValue: { name: company.name } });
  return company;
}

export async function remove(id: number, actor: string): Promise<Company | null> {
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) return null;
  await prisma.company.delete({ where: { id } });
  await audit.record({ entityType: 'company', entityId: id, action: 'delete', changedBy: actor, oldValue: { name: company.name } });
  return company;
}

export function devicesForCompany(companyId: number) {
  return prisma.device.findMany({ where: { companyId }, orderBy: { hostname: 'asc' } });
}

/**
 * Backfill: turn the legacy denormalized companyName strings on tickets/devices
 * into real Company records and link them by id. Idempotent — only touches rows
 * that have a companyName but no companyId yet.
 */
export async function backfillFromNames(actor: string): Promise<{ companies: number; tickets: number; devices: number }> {
  const ticketNames = await prisma.ticket.findMany({
    where: { companyId: null, companyName: { not: null } },
    distinct: ['companyName'],
    select: { companyName: true },
  });
  const deviceNames = await prisma.device.findMany({
    where: { companyId: null, companyName: { not: null } },
    distinct: ['companyName'],
    select: { companyName: true },
  });
  const names = Array.from(new Set([...ticketNames, ...deviceNames].map((x) => x.companyName!).filter(Boolean)));

  let companies = 0;
  let tickets = 0;
  let devices = 0;
  for (const name of names) {
    const existing = await prisma.company.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    const company = existing ?? (await create({ name }, actor));
    if (!existing) companies++;
    tickets += (await prisma.ticket.updateMany({ where: { companyId: null, companyName: name }, data: { companyId: company.id } })).count;
    devices += (await prisma.device.updateMany({ where: { companyId: null, companyName: name }, data: { companyId: company.id } })).count;
  }
  return { companies, tickets, devices };
}

/** Total logged time (minutes) across all of a company's tickets. */
export async function timeTotalMinutes(companyId: number): Promise<number> {
  const r = await prisma.note.aggregate({
    where: { noteType: 'time_entry', ticket: { companyId } },
    _sum: { minutes: true },
  });
  return r._sum.minutes ?? 0;
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export interface ContactInput {
  companyId: number;
  name: string;
  email?: string | null;
  phone?: string;
  title?: string;
  isPrimary?: boolean;
}

/**
 * Resolve a portal/email identity without guessing. Contact email is legacy
 * CRM data and is not structurally unique, so a duplicate case-insensitive
 * address is ambiguous and deliberately resolves to null.
 */
export async function findUniqueContactByEmail(
  email: string,
): Promise<ContactIdentityRow | null> {
  const normalized = normalizeContactIdentityEmail(email);
  if (!normalized) return null;
  const matches = await findContactsByNormalizedEmail(prisma, normalized);
  return matches.length === 1 ? matches[0] : null;
}

export async function createContact(input: ContactInput, actor: string): Promise<Contact> {
  const contact = await prisma.$transaction(async (tx) => {
    await lockPortalIdentityWrites(tx);
    const email = canonicalContactEmail(input.email);
    if (input.isPrimary) {
      await tx.contact.updateMany({ where: { companyId: input.companyId, isPrimary: true }, data: { isPrimary: false } });
    }
    const row = await tx.contact.create({
      data: { ...input, email },
    });
    await revokeIfEmailAmbiguous(
      tx,
      normalizeContactIdentityEmail(row.email),
    );
    await audit.record({
      entityType: 'contact',
      entityId: row.id,
      action: 'create',
      changedBy: actor,
      newValue: { name: row.name, companyId: row.companyId },
    }, tx);
    return row;
  });
  return contact;
}

export async function updateContact(id: number, input: Partial<ContactInput>, actor: string): Promise<Contact> {
  const contact = await prisma.$transaction(async (tx) => {
    await lockPortalIdentityWrites(tx);
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM contacts WHERE id = ${id} FOR UPDATE`,
    );
    const current = await tx.contact.findUnique({ where: { id } });
    if (!current) throw Object.assign(new Error('contact not found'), { statusCode: 404 });
    const email = Object.prototype.hasOwnProperty.call(input, 'email')
      ? canonicalContactEmail(input.email)
      : undefined;
    const data = {
      ...input,
      ...(email !== undefined || input.email === null ? { email } : {}),
    };
    const portalIdentityChanged =
      (input.companyId !== undefined && input.companyId !== current.companyId) ||
      (Object.prototype.hasOwnProperty.call(input, 'email') &&
        normalizeContactIdentityEmail(email) !==
          normalizeContactIdentityEmail(current.email));
    if (portalIdentityChanged) {
      // A portal credential authenticates the current Contact row. Without
      // revocation, an old mailbox/browser would silently inherit a reassigned
      // Contact's new company boundary. Keep revocation and the identity edit
      // atomic so neither can commit on its own.
      await revokeContactPortalCredentials(tx, [id]);
    }
    if (input.isPrimary) {
      await tx.contact.updateMany({
        where: { companyId: input.companyId ?? current.companyId, isPrimary: true, id: { not: id } },
        data: { isPrimary: false },
      });
    }
    const row = await tx.contact.update({ where: { id }, data });
    await revokeIfEmailAmbiguous(
      tx,
      normalizeContactIdentityEmail(row.email),
    );
    await audit.record({
      entityType: 'contact',
      entityId: id,
      action: 'update',
      changedBy: actor,
      newValue: { name: row.name },
    }, tx);
    return row;
  });
  return contact;
}

export async function removeContact(id: number, actor: string): Promise<Contact | null> {
  const contact = await prisma.contact.findUnique({ where: { id } });
  if (!contact) return null;
  await prisma.contact.delete({ where: { id } });
  await audit.record({ entityType: 'contact', entityId: id, action: 'delete', changedBy: actor, oldValue: { name: contact.name } });
  return contact;
}
