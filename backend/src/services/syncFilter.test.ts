import { describeSyncFilter, explainMismatch, matches, parseSyncFilter } from './syncFilter';

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

describe('people on a ticket', () => {
  // ConnectWise: an owner plus every member listed in `resources`.
  const cw = {
    assignee: 'jsmith, bdoe',
    assigneeNames: ['jsmith', 'bdoe'],
    assigneeIds: ['jsmith', 'bdoe'],
    status: 'New',
  };

  it('matches a technician ID when any person on the ticket is listed', () => {
    expect(matches(cw, { assigneeId: ['JSMITH'] })).toBe(true);
    expect(matches(cw, { assigneeId: ['bdoe'] })).toBe(true);
    expect(matches(cw, { assigneeId: ['nobody'] })).toBe(false);
  });

  it('matches a legacy name filter against each resource, not the joined string', () => {
    expect(matches(cw, { assignee: ['jsmith'] })).toBe(true);
    expect(matches({ assignee: 'jsmith, bdoe' }, { assignee: ['jsmith'] })).toBe(false);
  });

  it('rejects on an excluded ID if that person is anywhere on the ticket', () => {
    expect(matches(cw, { exclude: { assigneeId: ['bdoe'] } })).toBe(false);
    expect(matches({ assigneeIds: [] }, { exclude: { assigneeId: ['bdoe'] } })).toBe(true);
  });

  it('does not match an unassigned ticket to a technician filter', () => {
    expect(matches({ assigneeIds: [] }, { assigneeId: ['jsmith'] })).toBe(false);
  });
});

describe('explainMismatch', () => {
  const filter = { assigneeId: ['acc-1'], labels: { 'acc-1': 'Joe Tran', 'acc-2': 'Bob Smith' } };

  it('names people by their picked display name', () => {
    expect(explainMismatch({ assigneeIds: ['acc-2'] }, filter)).toBe(
      "it's assigned to “Bob Smith”; this job only syncs Joe Tran"
    );
    expect(explainMismatch({ assigneeIds: [] }, filter)).toBe("it's unassigned; this job only syncs Joe Tran");
    expect(explainMismatch({ assigneeIds: ['acc-2'] }, { exclude: { assigneeId: ['acc-2'] }, labels: filter.labels })).toBe(
      "it's assigned to “Bob Smith”, whom this job excludes"
    );
  });

  it('explains excludes', () => {
    expect(explainMismatch({ status: 'Closed' }, { exclude: { status: ['Closed'] } })).toBe(
      'status is “Closed”, which this job excludes'
    );
    expect(explainMismatch({ status: 'Closed' }, { status: ['New', 'Open'] })).toBe(
      'status is “Closed”; this job only syncs status New, Open'
    );
  });

  it('returns null for a matching ticket', () => {
    expect(explainMismatch({ assigneeIds: ['acc-1'] }, filter)).toBeNull();
  });
});

describe('parseSyncFilter labels', () => {
  it('keeps labels alongside real clauses, and ignores them alone', () => {
    expect(parseSyncFilter({ assigneeId: ['a'], labels: { a: 'Joe' } })).toEqual({ assigneeId: ['a'], labels: { a: 'Joe' } });
    expect(parseSyncFilter({ labels: { a: 'Joe' } })).toBeNull();
    expect(() => parseSyncFilter({ assigneeId: ['a'], labels: [] })).toThrow(/labels must be an object/);
  });

  it('describes ID clauses by name', () => {
    expect(describeSyncFilter({ assigneeId: ['a'], labels: { a: 'Joe' } })).toBe('assigneeId in [Joe]');
  });
});
