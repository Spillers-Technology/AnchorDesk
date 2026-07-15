/**
 * Custom ticket fields: definitions live in CustomFieldDef, values ride on
 * Ticket.customFields (jsonb keyed by def key). This module owns validation so
 * every write path (REST, MCP, automation) enforces the same shape.
 * `validateCustomFieldValues` is pure and unit-tested DB-free.
 */
import type { CustomFieldDef } from '@prisma/client';
import * as customFieldRepo from '../repositories/customFieldRepository';

export class CustomFieldValidationError extends Error {}

type Defs = Pick<CustomFieldDef, 'key' | 'label' | 'type' | 'options' | 'required' | 'archived'>[];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * Validate a partial value map against the definitions. Returns a normalized
 * copy (numbers coerced, strings trimmed). `null` clears a field and is always
 * allowed for non-required fields. A missing required key is permitted so
 * automated intake can create a ticket before enrichment; once that key is
 * supplied, it cannot be blanked or cleared. Unknown and archived keys are
 * rejected so typos never silently persist.
 */
export function validateCustomFieldValues(
  defs: Defs,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (!isPlainRecord(values)) throw new CustomFieldValidationError('customFields must be an object');
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) throw new CustomFieldValidationError(`Unknown custom field "${key}"`);
    if (def.archived) throw new CustomFieldValidationError(`Custom field "${key}" is archived`);

    if (isEmpty(raw)) {
      if (def.required) throw new CustomFieldValidationError(`Custom field "${def.label}" is required`);
      out[key] = null;
      continue;
    }

    switch (def.type) {
      case 'text': {
        if (typeof raw !== 'string') throw new CustomFieldValidationError(`"${def.label}" must be text`);
        out[key] = raw.trim().slice(0, 2000);
        break;
      }
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) throw new CustomFieldValidationError(`"${def.label}" must be a number`);
        out[key] = n;
        break;
      }
      case 'boolean': {
        if (typeof raw === 'boolean') out[key] = raw;
        else if (raw === 'true' || raw === 'false') out[key] = raw === 'true';
        else throw new CustomFieldValidationError(`"${def.label}" must be true or false`);
        break;
      }
      case 'date': {
        const parsed = typeof raw === 'string' && DATE_RE.test(raw)
          ? new Date(`${raw}T00:00:00.000Z`)
          : null;
        if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
          throw new CustomFieldValidationError(`"${def.label}" must be a YYYY-MM-DD date`);
        }
        out[key] = raw;
        break;
      }
      case 'select': {
        const options = Array.isArray(def.options) ? (def.options as unknown[]).map(String) : [];
        if (typeof raw !== 'string' || !options.includes(raw)) {
          throw new CustomFieldValidationError(
            `"${def.label}" must be one of: ${options.join(', ') || '(no options defined)'}`,
          );
        }
        out[key] = raw;
        break;
      }
    }
  }
  return out;
}

/**
 * Merge an incoming partial value map into the existing stored map, validating
 * against the live definitions. Keys set to null are removed from storage.
 */
export async function mergeCustomFields(
  existing: unknown,
  incoming: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!isPlainRecord(incoming)) throw new CustomFieldValidationError('customFields must be an object');
  const defs = await customFieldRepo.list({ includeArchived: true });
  const validated = validateCustomFieldValues(defs, incoming);
  const base: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(validated)) {
    if (value === null) delete base[key];
    else base[key] = value;
  }
  return base;
}
