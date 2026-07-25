import { describeSyncFilter, matches, parseSyncFilter } from './syncFilter';

describe('matches', () => {
  const ticket = {
    assignee: 'Joe Spillers',
    status: 'In Progress',
    priority: 'High',
    companyName: 'SpillersTech',
  };

  it('matches everything when there is no filter', () => {
    expect(matches(ticket, null)).toBe(true);
    expect(matches(ticket, undefined)).toBe(true);
    expect(matches(ticket, {})).toBe(true);
  });

  it('matches on a single field, case- and whitespace-insensitively', () => {
    expect(matches(ticket, { assignee: ['joe spillers'] })).toBe(true);
    expect(matches(ticket, { assignee: ['  Joe Spillers  '] })).toBe(true);
    expect(matches(ticket, { assignee: ['Someone Else'] })).toBe(false);
  });

  it('ORs within a field and ANDs across fields', () => {
    expect(matches(ticket, { assignee: ['Nobody', 'Joe Spillers'] })).toBe(true);
    expect(matches(ticket, { assignee: ['Joe Spillers'], status: ['In Progress'] })).toBe(true);
    expect(matches(ticket, { assignee: ['Joe Spillers'], status: ['Closed'] })).toBe(false);
  });

  it('applies exclude after include, and exclude wins', () => {
    expect(matches(ticket, { assignee: ['Joe Spillers'], exclude: { status: ['In Progress'] } })).toBe(false);
    expect(matches(ticket, { exclude: { status: ['Closed'] } })).toBe(true);
  });

  it('treats a missing field as empty rather than matching anything', () => {
    expect(matches({ assignee: undefined }, { assignee: ['Joe Spillers'] })).toBe(false);
    expect(matches({ assignee: undefined }, { assignee: [''] })).toBe(true);
  });
});

describe('parseSyncFilter', () => {
  it('returns null for absent or empty filters', () => {
    expect(parseSyncFilter(undefined)).toBeNull();
    expect(parseSyncFilter(null)).toBeNull();
    expect(parseSyncFilter({})).toBeNull();
    expect(parseSyncFilter({ assignee: [] })).toBeNull();
  });

  it('trims values and drops empties', () => {
    expect(parseSyncFilter({ assignee: ['  Joe  ', ''] })).toEqual({ assignee: ['Joe'] });
  });

  it('parses exclude clauses', () => {
    expect(parseSyncFilter({ exclude: { status: ['Closed'] } })).toEqual({ exclude: { status: ['Closed'] } });
  });

  // The point of validating: a typo must fail loudly. Ignoring an unknown key
  // would widen the sync instead of narrowing it, which is the dangerous
  // direction to be wrong in.
  it('rejects unknown fields rather than silently widening the sync', () => {
    expect(() => parseSyncFilter({ assignedTo: ['Joe'] })).toThrow(/unknown filter field "assignedTo"/);
    expect(() => parseSyncFilter({ exclude: { nope: ['x'] } })).toThrow(/unknown filter field "exclude.nope"/);
  });

  it('rejects malformed shapes', () => {
    expect(() => parseSyncFilter('assignee=joe')).toThrow(/must be an object/);
    expect(() => parseSyncFilter([])).toThrow(/must be an object/);
    expect(() => parseSyncFilter({ assignee: 'Joe' })).toThrow(/must be an array/);
    expect(() => parseSyncFilter({ assignee: [1] })).toThrow(/only strings/);
    expect(() => parseSyncFilter({ exclude: [] })).toThrow(/exclude must be an object/);
  });
});

describe('describeSyncFilter', () => {
  it('summarizes include and exclude clauses', () => {
    expect(describeSyncFilter(null)).toBe('no filter (all tickets)');
    expect(describeSyncFilter({ assignee: ['Joe'], exclude: { status: ['Closed'] } })).toBe(
      'assignee in [Joe] AND status not in [Closed]'
    );
  });
});
