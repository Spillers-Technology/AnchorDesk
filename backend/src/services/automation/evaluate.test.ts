import {
  evaluateCondition,
  evaluateConditions,
  ticketContext,
  validateRuleAction,
  validateRuleCondition,
} from './evaluate';

describe('automation condition evaluation', () => {
  const ctx = {
    status: 'In Progress',
    priority: 'High',
    teamId: 4,
    labelIds: [2, 7],
    count: 12,
    empty: null,
  };

  it.each([
    [{ field: 'status', op: 'eq', value: 'in progress' }, true],
    [{ field: 'priority', op: 'neq', value: 'low' }, true],
    [{ field: 'status', op: 'contains', value: 'progress' }, true],
    [{ field: 'labelIds', op: 'contains', value: 7 }, true],
    [{ field: 'teamId', op: 'in', value: [3, 4] }, true],
    [{ field: 'count', op: 'gte', value: 10 }, true],
    [{ field: 'count', op: 'lte', value: 5 }, false],
    [{ field: 'status', op: 'set' }, true],
    [{ field: 'empty', op: 'unset' }, true],
  ] as const)('evaluates %j', (condition, expected) => {
    expect(evaluateCondition(condition, ctx)).toBe(expected);
  });

  it('uses all-of semantics and lets an empty condition list match', () => {
    expect(evaluateConditions([], ctx)).toBe(true);
    expect(evaluateConditions([
      { field: 'priority', op: 'eq', value: 'High' },
      { field: 'teamId', op: 'eq', value: 99 },
    ], ctx)).toBe(false);
  });

  it('flattens labels and custom fields into the rule context', () => {
    expect(ticketContext({
      status: 'New',
      teamId: 3,
      labels: [{ labelId: 8 }],
      customFields: { site: 'HQ', seats: 12 },
    })).toMatchObject({
      status: 'New',
      teamId: 3,
      labelIds: [8],
      'custom.site': 'HQ',
      'custom.seats': 12,
    });
  });

  it('exposes the effective deadline as dueAt (manual override beats SLA)', () => {
    const manual = new Date('2026-07-18T09:00:00Z');
    const sla = new Date('2026-07-20T12:00:00Z');
    expect(ticketContext({ dueAt: manual, resolutionDueAt: sla }).dueAt).toBe(manual.toISOString());
    expect(ticketContext({ dueAt: null, resolutionDueAt: sla }).dueAt).toBe(sla.toISOString());
    expect(ticketContext({})).toMatchObject({ dueAt: null });
    // set/unset and lexicographic lte conditions work against the ISO string.
    const ctx = ticketContext({ dueAt: manual, resolutionDueAt: null });
    expect(evaluateConditions([{ field: 'dueAt', op: 'set' }], ctx)).toBe(true);
    expect(evaluateConditions([{ field: 'dueAt', op: 'lte', value: '2026-07-19T00:00:00Z' }], ctx)).toBe(true);
  });
});

describe('automation rule JSON validation', () => {
  it('accepts supported built-in and custom-field conditions', () => {
    expect(validateRuleCondition({ field: 'status', op: 'eq', value: 'Open' })).toBeNull();
    expect(validateRuleCondition({ field: 'custom.site', op: 'set' })).toBeNull();
    expect(validateRuleCondition({ field: 'labelIds', op: 'in', value: [2, 3] })).toBeNull();
  });

  it.each([
    [{ field: 'not_a_field', op: 'eq', value: 1 }, 'field is not supported'],
    [{ field: 'status', op: 'bogus', value: 1 }, 'op must be one of'],
    [{ field: 'status', op: 'eq' }, 'needs a value'],
    [{ field: 'teamId', op: 'in', value: [] }, 'non-empty value array'],
    [{ field: 'teamId', op: 'gte', value: 'many' }, 'numeric value'],
  ])('rejects malformed conditions %#', (condition, message) => {
    expect(validateRuleCondition(condition)).toContain(message);
  });

  it.each([
    { type: 'set_status', status: 'Waiting' },
    { type: 'set_priority', priority: 'Critical' },
    { type: 'assign_user', userId: 2 },
    { type: 'assign_team', teamId: 3 },
    { type: 'add_label', labelId: 4 },
    { type: 'add_note', content: 'Escalated automatically' },
    { type: 'notify_user', userId: 2, message: 'Please review' },
    { type: 'notify_team', teamId: 3 },
  ])('accepts a valid $type action', (action) => {
    expect(validateRuleAction(action)).toBeNull();
  });

  it.each([
    [{ type: 'set_status' }, 'needs a non-empty status'],
    [{ type: 'assign_user', userId: 0 }, 'positive integer userId'],
    [{ type: 'assign_team', teamId: '3' }, 'positive integer teamId'],
    [{ type: 'add_label' }, 'positive integer labelId'],
    [{ type: 'add_note', content: '' }, 'non-empty content'],
    [{ type: 'notify_user', userId: 2, message: 7 }, 'message must be a string'],
    [{ type: 'unknown' }, 'not supported'],
  ])('rejects malformed actions %#', (action, message) => {
    expect(validateRuleAction(action)).toContain(message);
  });
});
