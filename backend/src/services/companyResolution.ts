import { Company, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from '../repositories/auditRepository';

export const INTERNAL_COMPANY_NAME = process.env.INTERNAL_COMPANY_NAME?.trim() || 'SpillersTech';

function displayNameForDomain(domain: string): string {
  const stem = domain.split('.')[0].replace(/[-_]+/g, ' ').trim();
  if (!stem) return domain;
  return stem.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Return the normalized sender domain and a useful initial company name. */
export function companyFromEmail(email: string | null | undefined): { name: string; domain: string } | null {
  const address = email?.trim().toLowerCase();
  const at = address?.lastIndexOf('@') ?? -1;
  if (!address || at <= 0 || at === address.length - 1) return null;
  const domain = address.slice(at + 1).replace(/^www\./, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  return { name: displayNameForDomain(domain), domain };
}

async function createCompany(
  data: { name: string; domain?: string },
  actor: string,
): Promise<Company> {
  try {
    const company = await prisma.company.create({ data });
    await audit.record({
      entityType: 'company',
      entityId: company.id,
      action: 'create',
      changedBy: actor,
      newValue: { name: company.name, domain: company.domain },
    });
    return company;
  } catch (error) {
    // Concurrent inbound messages for one new domain may race. The company name
    // is unique, so recover the winner instead of failing email ingestion.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await prisma.company.findFirst({
        where: { name: { equals: data.name, mode: 'insensitive' } },
      });
      if (winner) return winner;
    }
    throw error;
  }
}

export async function findOrCreateNamedCompany(name: string, actor: string): Promise<Company> {
  const trimmed = name.trim();
  const existing = await prisma.company.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  });
  return existing ?? createCompany({ name: trimmed }, actor);
}

export async function findOrCreateCompanyForEmail(email: string, actor: string): Promise<Company | null> {
  const candidate = companyFromEmail(email);
  if (!candidate) return null;
  const existing = await prisma.company.findFirst({
    where: { domain: { equals: candidate.domain, mode: 'insensitive' } },
  });
  return existing ?? createCompany(candidate, actor);
}

/**
 * Resolve the mandatory company link for a ticket. Explicit ids win, legacy
 * names are promoted into Company rows, and truly unclassified work lands in
 * the internal company rather than becoming an orphan.
 */
export async function resolveTicketCompany(
  input: { companyId?: number | null; companyName?: string | null },
  actor: string,
): Promise<Company> {
  if (input.companyId) {
    const company = await prisma.company.findUnique({ where: { id: input.companyId } });
    if (!company) throw Object.assign(new Error('company not found'), { statusCode: 400 });
    return company;
  }
  const name = input.companyName?.trim() || INTERNAL_COMPANY_NAME;
  return findOrCreateNamedCompany(name, actor);
}
