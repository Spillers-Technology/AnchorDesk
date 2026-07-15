import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';

/** Mirrors the /tickets query surface so a view can be replayed verbatim. */
export interface SavedViewFilters {
  status?: string;
  assignee?: string;
  company?: string;
  q?: string;
  regex?: string;
  labelId?: number;
  teamId?: number;
  includeClosed?: boolean;
}

export class SavedViewValidationError extends Error {}

const FILTER_KEYS = new Set(['status', 'assignee', 'company', 'q', 'regex', 'labelId', 'teamId', 'includeClosed']);

/** Validate and normalize the replayable /tickets query stored in a view. */
export function normalizeSavedViewFilters(value: unknown): SavedViewFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SavedViewValidationError('filters must be an object');
  }
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).find((key) => !FILTER_KEYS.has(key));
  if (unknown) throw new SavedViewValidationError(`Unsupported saved-view filter: ${unknown}`);

  const out: SavedViewFilters = {};
  for (const key of ['status', 'assignee', 'company', 'q', 'regex'] as const) {
    const field = input[key];
    if (field === undefined) continue;
    if (typeof field !== 'string' || field.length > 500) {
      throw new SavedViewValidationError(`${key} must be a string up to 500 characters`);
    }
    const normalized = field.trim();
    if (normalized) out[key] = normalized;
  }
  for (const key of ['labelId', 'teamId'] as const) {
    const field = input[key];
    if (field === undefined) continue;
    if (typeof field !== 'number' || !Number.isInteger(field) || field <= 0) {
      throw new SavedViewValidationError(`${key} must be a positive integer`);
    }
    out[key] = field;
  }
  if (input.includeClosed !== undefined) {
    if (typeof input.includeClosed !== 'boolean') throw new SavedViewValidationError('includeClosed must be a boolean');
    out.includeClosed = input.includeClosed;
  }
  return out;
}

export interface SavedViewInput {
  name: string;
  filters: SavedViewFilters;
  shared?: boolean;
  sortOrder?: number;
}

/** A user sees their own views plus shared ones. */
export function listForUser(userId: number) {
  return prisma.savedView.findMany({
    where: {
      OR: [
        { userId },
        { shared: true },
        ...(userId === 0 ? [{ userId: null, shared: false }] : []),
      ],
    },
    orderBy: [{ shared: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export function getById(id: number) {
  return prisma.savedView.findUnique({ where: { id } });
}

export async function create(userId: number, input: SavedViewInput, actorSub: string) {
  const view = await prisma.savedView.create({
    data: {
      // Shared views are global. The dev-admin (id 0) has no User row, so its
      // personal views also use a null FK and are distinguished by shared=false.
      userId: input.shared || userId === 0 ? null : userId,
      name: input.name.trim(),
      filters: normalizeSavedViewFilters(input.filters) as unknown as Prisma.InputJsonValue,
      shared: input.shared ?? false,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  await audit.record({
    entityType: 'saved_view',
    entityId: view.id,
    action: 'create',
    changedBy: actorSub,
    newValue: { name: view.name, shared: view.shared, userId: view.userId },
  });
  return view;
}

export async function update(id: number, input: Partial<SavedViewInput>, actorSub: string) {
  const before = await prisma.savedView.findUnique({ where: { id } });
  const view = await prisma.savedView.update({
    where: { id },
    data: {
      name: input.name?.trim(),
      filters: input.filters !== undefined
        ? normalizeSavedViewFilters(input.filters) as unknown as Prisma.InputJsonValue
        : undefined,
      sortOrder: input.sortOrder,
    },
  });
  await audit.record({
    entityType: 'saved_view',
    entityId: id,
    action: 'update',
    changedBy: actorSub,
    oldValue: before ? { name: before.name, filters: before.filters, sortOrder: before.sortOrder } : null,
    newValue: { name: view.name, filters: view.filters, sortOrder: view.sortOrder },
  });
  return view;
}

export async function remove(id: number, actorSub: string) {
  const view = await prisma.savedView.delete({ where: { id } });
  await audit.record({
    entityType: 'saved_view',
    entityId: id,
    action: 'delete',
    changedBy: actorSub,
    oldValue: { name: view.name, shared: view.shared, userId: view.userId },
  });
  return view;
}
