import { CustomFieldType, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';

export interface CustomFieldDefInput {
  key: string;
  label: string;
  type: CustomFieldType;
  options?: string[] | null;
  required?: boolean;
  sortOrder?: number;
  archived?: boolean;
}

/** Keys are stable identifiers used in Ticket.customFields — snake/kebab-free. */
const KEY_RE = /^[a-z][a-z0-9_]{0,59}$/;

export function isValidKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function list(opts: { includeArchived?: boolean } = {}) {
  return prisma.customFieldDef.findMany({
    where: opts.includeArchived ? {} : { archived: false },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
}

export function getById(id: number) {
  return prisma.customFieldDef.findUnique({ where: { id } });
}

export async function create(input: CustomFieldDefInput, actorSub: string) {
  const def = await prisma.customFieldDef.create({
    data: {
      key: input.key.trim(),
      label: input.label.trim(),
      type: input.type,
      options: Array.isArray(input.options)
        ? input.options.map((option) => option.trim()) as Prisma.InputJsonValue
        : undefined,
      required: input.required ?? false,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  await audit.record({
    entityType: 'custom_field',
    entityId: def.id,
    action: 'create',
    changedBy: actorSub,
    newValue: { key: def.key, label: def.label, type: def.type },
  });
  return def;
}

export async function update(id: number, input: Partial<Omit<CustomFieldDefInput, 'key' | 'type'>>, actorSub: string) {
  // key and type are immutable once values may exist — archive and recreate instead.
  const before = await prisma.customFieldDef.findUnique({ where: { id } });
  const def = await prisma.customFieldDef.update({
    where: { id },
    data: {
      label: input.label?.trim(),
      options: input.options === undefined
        ? undefined
        : input.options === null
          ? Prisma.DbNull
          : input.options.map((option) => option.trim()) as Prisma.InputJsonValue,
      required: input.required,
      sortOrder: input.sortOrder,
      archived: input.archived,
    },
  });
  await audit.record({
    entityType: 'custom_field',
    entityId: id,
    action: 'update',
    changedBy: actorSub,
    oldValue: before ? { label: before.label, archived: before.archived } : null,
    newValue: { label: def.label, archived: def.archived },
  });
  return def;
}

export async function remove(id: number, actorSub: string) {
  const before = await prisma.customFieldDef.findUnique({ where: { id } });
  if (!before) return null;
  await prisma.customFieldDef.delete({ where: { id } });
  await audit.record({
    entityType: 'custom_field',
    entityId: id,
    action: 'delete',
    changedBy: actorSub,
    oldValue: before ? { key: before.key, label: before.label } : null,
  });
  return before;
}
