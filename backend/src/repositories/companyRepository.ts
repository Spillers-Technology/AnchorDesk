/**
 * Company + Contact DB access (the CRM layer). All mutations record to the
 * append-only audit log so company/contact changes are attributable.
 */
import { Company, Contact, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';

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
  email?: string;
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
  email?: string;
  phone?: string;
  title?: string;
  isPrimary?: boolean;
}

export async function createContact(input: ContactInput, actor: string): Promise<Contact> {
  const contact = await prisma.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.contact.updateMany({ where: { companyId: input.companyId, isPrimary: true }, data: { isPrimary: false } });
    }
    return tx.contact.create({ data: input });
  });
  await audit.record({ entityType: 'contact', entityId: contact.id, action: 'create', changedBy: actor, newValue: { name: contact.name, companyId: contact.companyId } });
  return contact;
}

export async function updateContact(id: number, input: Partial<ContactInput>, actor: string): Promise<Contact> {
  const contact = await prisma.$transaction(async (tx) => {
    const current = await tx.contact.findUnique({ where: { id } });
    if (!current) throw Object.assign(new Error('contact not found'), { statusCode: 404 });
    if (input.isPrimary) {
      await tx.contact.updateMany({
        where: { companyId: input.companyId ?? current.companyId, isPrimary: true, id: { not: id } },
        data: { isPrimary: false },
      });
    }
    return tx.contact.update({ where: { id }, data: input });
  });
  await audit.record({ entityType: 'contact', entityId: id, action: 'update', changedBy: actor, newValue: { name: contact.name } });
  return contact;
}

export async function removeContact(id: number, actor: string): Promise<Contact | null> {
  const contact = await prisma.contact.findUnique({ where: { id } });
  if (!contact) return null;
  await prisma.contact.delete({ where: { id } });
  await audit.record({ entityType: 'contact', entityId: id, action: 'delete', changedBy: actor, oldValue: { name: contact.name } });
  return contact;
}
