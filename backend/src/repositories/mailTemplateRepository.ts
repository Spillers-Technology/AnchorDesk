import { prisma } from '../db/prisma';
import { sanitizeEmailHtml } from '../services/mail/sanitizeHtml';

export interface MailTemplateInput {
  name: string;
  subject?: string | null;
  bodyHtml: string;
}

export function list() {
  return prisma.mailTemplate.findMany({ orderBy: { name: 'asc' } });
}

export function getById(id: number) {
  return prisma.mailTemplate.findUnique({ where: { id } });
}

export function create(input: MailTemplateInput) {
  return prisma.mailTemplate.create({
    data: { name: input.name, subject: input.subject ?? null, bodyHtml: sanitizeEmailHtml(input.bodyHtml) },
  });
}

export function update(id: number, input: Partial<MailTemplateInput>) {
  const data: Record<string, unknown> = { ...input };
  if (input.bodyHtml != null) data.bodyHtml = sanitizeEmailHtml(input.bodyHtml);
  return prisma.mailTemplate.update({ where: { id }, data });
}

export function remove(id: number) {
  return prisma.mailTemplate.delete({ where: { id } });
}
