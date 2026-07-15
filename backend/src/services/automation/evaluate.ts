/**
 * Pure condition evaluation for automation rules — no DB, unit-tested.
 * A rule's `conditions` is an all-of array matched against a flat snapshot of
 * the ticket (plus event fields for SLA triggers). Field names:
 *   status, priority, companyName, assignee, teamId, source, labelIds,
 *   custom.<key>  (ticket custom fields)
 *   kind, level   (sla_at_risk / sla_breached triggers: response|resolution)
 */

export type ConditionOp = 'eq' | 'neq' | 'contains' | 'in' | 'gte' | 'lte' | 'set' | 'unset';

export interface RuleCondition {
  field: string;
  op: ConditionOp;
  value?: unknown;
}

export type RuleAction =
  | { type: 'set_status'; status: string }
  | { type: 'set_priority'; priority: string }
  | { type: 'assign_user'; userId: number }
  | { type: 'assign_team'; teamId: number }
  | { type: 'add_label'; labelId: number }
  | { type: 'add_note'; content: string }
  | { type: 'notify_user'; userId: number; message?: string }
  | { type: 'notify_team'; teamId: number; message?: string };

export type EvalContext = Record<string, unknown>;

const CONDITION_OPS: ConditionOp[] = ['eq', 'neq', 'contains', 'in', 'gte', 'lte', 'set', 'unset'];
const BUILTIN_FIELDS = new Set([
  'status', 'priority', 'companyName', 'assignee', 'assigneeId', 'teamId',
  'source', 'title', 'labelIds', 'kind', 'level',
]);
const CUSTOM_FIELD_RE = /^custom\.[a-z][a-z0-9_]{0,59}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveId(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Validate persisted condition JSON before a rule can be enabled. */
export function validateRuleCondition(value: unknown): string | null {
  if (!isRecord(value)) return 'condition must be an object';
  if (typeof value.field !== 'string' || (!BUILTIN_FIELDS.has(value.field) && !CUSTOM_FIELD_RE.test(value.field))) {
    return 'condition field is not supported';
  }
  if (!CONDITION_OPS.includes(value.op as ConditionOp)) return `condition op must be one of: ${CONDITION_OPS.join(', ')}`;
  const op = value.op as ConditionOp;
  if (op !== 'set' && op !== 'unset' && !('value' in value)) return `condition ${op} needs a value`;
  if (op === 'in' && (!Array.isArray(value.value) || value.value.length === 0 || value.value.length > 100)) {
    return 'condition in needs a non-empty value array (maximum 100)';
  }
  if ((op === 'gte' || op === 'lte') && !Number.isFinite(Number(value.value))) {
    return `condition ${op} needs a numeric value`;
  }
  return null;
}

/** Validate action-specific parameters, not just the action discriminator. */
export function validateRuleAction(value: unknown): string | null {
  if (!isRecord(value) || typeof value.type !== 'string') return 'action must be an object with a type';
  const boundedString = (field: string, max: number) =>
    typeof value[field] === 'string' && Boolean((value[field] as string).trim()) && (value[field] as string).length <= max;
  switch (value.type) {
    case 'set_status':
      return boundedString('status', 100) ? null : 'set_status needs a non-empty status up to 100 characters';
    case 'set_priority':
      return boundedString('priority', 50) ? null : 'set_priority needs a non-empty priority up to 50 characters';
    case 'assign_user':
    case 'notify_user':
      if (!positiveId(value.userId)) return `${value.type} needs a positive integer userId`;
      break;
    case 'assign_team':
    case 'notify_team':
      if (!positiveId(value.teamId)) return `${value.type} needs a positive integer teamId`;
      break;
    case 'add_label':
      return positiveId(value.labelId) ? null : 'add_label needs a positive integer labelId';
    case 'add_note':
      return boundedString('content', 20_000) ? null : 'add_note needs non-empty content up to 20000 characters';
    default:
      return 'action type is not supported';
  }
  if (value.message !== undefined && (typeof value.message !== 'string' || value.message.length > 255)) {
    return `${value.type} message must be a string up to 255 characters`;
  }
  return null;
}

function lower(v: unknown): string {
  return String(v ?? '').toLowerCase();
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/** Loose equality: case-insensitive strings, numeric when both sides are numeric. */
function looseEq(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return lower(a) === lower(b);
  return lower(a) === lower(b);
}

export function evaluateCondition(condition: RuleCondition, ctx: EvalContext): boolean {
  const actual = ctx[condition.field];
  switch (condition.op) {
    case 'eq':
      if (Array.isArray(actual)) return actual.some((v) => looseEq(v, condition.value));
      return looseEq(actual, condition.value);
    case 'neq':
      if (Array.isArray(actual)) return !actual.some((v) => looseEq(v, condition.value));
      return !looseEq(actual, condition.value);
    case 'contains':
      if (Array.isArray(actual)) return actual.some((v) => looseEq(v, condition.value));
      return lower(actual).includes(lower(condition.value));
    case 'in': {
      const options = Array.isArray(condition.value) ? condition.value : [condition.value];
      if (Array.isArray(actual)) return actual.some((v) => options.some((o) => looseEq(v, o)));
      return options.some((o) => looseEq(actual, o));
    }
    case 'gte': {
      const a = Number(actual);
      const b = Number(condition.value);
      return Number.isFinite(a) && Number.isFinite(b) && a >= b;
    }
    case 'lte': {
      const a = Number(actual);
      const b = Number(condition.value);
      return Number.isFinite(a) && Number.isFinite(b) && a <= b;
    }
    case 'set':
      return !isEmpty(actual);
    case 'unset':
      return isEmpty(actual);
    default:
      return false;
  }
}

/** All-of semantics; an empty condition list matches every event. */
export function evaluateConditions(conditions: RuleCondition[], ctx: EvalContext): boolean {
  return conditions.every((c) => evaluateCondition(c, ctx));
}

/** Flatten a ticket row (with labels + custom fields) into an eval context. */
export function ticketContext(ticket: {
  status?: string | null;
  priority?: string | null;
  companyName?: string | null;
  assignee?: string | null;
  assigneeId?: number | null;
  teamId?: number | null;
  source?: string | null;
  title?: string | null;
  customFields?: unknown;
  labels?: { labelId: number }[];
}): EvalContext {
  const ctx: EvalContext = {
    status: ticket.status ?? null,
    priority: ticket.priority ?? null,
    companyName: ticket.companyName ?? null,
    assignee: ticket.assignee ?? null,
    assigneeId: ticket.assigneeId ?? null,
    teamId: ticket.teamId ?? null,
    source: ticket.source ?? null,
    title: ticket.title ?? null,
    labelIds: (ticket.labels ?? []).map((l) => l.labelId),
  };
  const custom = ticket.customFields;
  if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
    for (const [key, value] of Object.entries(custom as Record<string, unknown>)) {
      ctx[`custom.${key}`] = value;
    }
  }
  return ctx;
}
