/**
 * Checklist template CRUD ("boilerplating"): admin-managed reusable lists
 * whose items are copied onto tickets by checklistRepository.applyTemplate.
 * Items are replaced wholesale on update — templates are small and the
 * copy-on-apply model means rewriting them never touches ticket data.
 */
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';

export interface ChecklistTemplateItemInput {
  text: string;
  /** Relative deadline: item dueAt = apply time + offset. Null = no deadline. */
  dueOffsetMinutes?: number | null;
}

export interface ChecklistTemplateInput {
  name: string;
  description?: string | null;
  active?: boolean;
  items?: ChecklistTemplateItemInput[];
}

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function itemData(items: ChecklistTemplateItemInput[]) {
  return items.map((item, index) => ({
    text: clamp(item.text.trim(), 500),
    sortOrder: index,
    dueOffsetMinutes: item.dueOffsetMinutes ?? null,
  }));
}

export function list(opts: { includeInactive?: boolean } = {}) {
  return prisma.checklistTemplate.findMany({
    where: opts.includeInactive ? {} : { active: true },
    orderBy: { name: 'asc' },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
}

export function getById(id: number) {
  return prisma.checklistTemplate.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
}

export async function create(input: ChecklistTemplateInput, actorSub: string) {
  const template = await prisma.checklistTemplate.create({
    data: {
      name: clamp(input.name.trim(), 150),
      description: input.description ? clamp(input.description.trim(), 500) : null,
      active: input.active ?? true,
      createdBy: actorSub,
      items: { create: itemData(input.items ?? []) },
    },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
  await audit.record({
    entityType: 'checklist_template',
    entityId: template.id,
    action: 'create',
    changedBy: actorSub,
    newValue: { name: template.name, items: template.items.length },
  });
  return template;
}

export async function update(id: number, input: Partial<ChecklistTemplateInput>, actorSub: string) {
  const before = await getById(id);
  if (!before) return null;
  const template = await prisma.$transaction(async (tx) => {
    if (input.items !== undefined) {
      await tx.checklistTemplateItem.deleteMany({ where: { templateId: id } });
    }
    return tx.checklistTemplate.update({
      where: { id },
      data: {
        name: input.name !== undefined ? clamp(input.name.trim(), 150) : undefined,
        description:
          input.description === undefined
            ? undefined
            : input.description
              ? clamp(input.description.trim(), 500)
              : null,
        active: input.active,
        items: input.items !== undefined ? { create: itemData(input.items) } : undefined,
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  });
  await audit.record({
    entityType: 'checklist_template',
    entityId: id,
    action: 'update',
    changedBy: actorSub,
    oldValue: { name: before.name, active: before.active, items: before.items.length },
    newValue: { name: template.name, active: template.active, items: template.items.length },
  });
  return template;
}

/** Hard delete — instantiated ticket items carry copies, never references. */
export async function remove(id: number, actorSub: string) {
  const before = await getById(id);
  if (!before) return false;
  await prisma.checklistTemplate.delete({ where: { id } });
  await audit.record({
    entityType: 'checklist_template',
    entityId: id,
    action: 'delete',
    changedBy: actorSub,
    oldValue: { name: before.name, items: before.items.length },
  });
  return true;
}
