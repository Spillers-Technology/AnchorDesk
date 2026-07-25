import {
  SyncProviderValidationError,
  mergeJobConfig,
  publicConfig,
  syncScopeChanged,
  toPublic,
} from './syncProviderRepository';
import type { SyncProviderRow } from './syncProviderRepository';

const row = (over: Partial<SyncProviderRow> = {}): SyncProviderRow => ({
  id: 1,
  name: 'Jira — SpillersTech',
  type: 'jira',
  config: { projectKey: 'HELP', jql: '', filter: { status: ['To Do'] } },
  enabled: true,
  lastSyncedAt: null,
  configRevision: 1,
  createdAt: new Date('2026-07-25T00:00:00Z'),
  connectionId: 3,
  ...over,
});

describe('publicConfig', () => {
  it('keeps only this type\'s allowed fields, plus filter', () => {
    const out = publicConfig('jira', { projectKey: 'HELP', jql: 'assignee = x', filter: { status: ['Open'] } });
    expect(out).toEqual({ projectKey: 'HELP', jql: 'assignee = x', filter: { status: ['Open'] } });
  });

  it('drops a legacy or unrecognized key rather than leaking it', () => {
    // Simulates a hand-edited or pre-migration row carrying a stray key — the
    // read DTO must never widen beyond this type's current vocabulary.
    const out = publicConfig('jira', { projectKey: 'HELP', board: 'should not appear', apiToken: 'nope' });
    expect(out).toEqual({ projectKey: 'HELP' });
  });

  it('omits empty-string fields', () => {
    expect(publicConfig('jira', { projectKey: '', jql: '' })).toEqual({});
  });

  it('keeps only board for connectwise', () => {
    expect(publicConfig('connectwise', { board: 'Support', projectKey: 'nope' })).toEqual({ board: 'Support' });
  });

  it('re-parses filter through the shared vocabulary rather than copying it raw', () => {
    // parseSyncFilter rejects a stray key outright rather than silently
    // stripping it (matches create/update validation), so a filter carrying
    // one reads as "unset" — safe either way, but confirms nothing here
    // silently trusts the raw stored JSON. This is also how a secret placed
    // under `filter` by mistake would otherwise leak.
    const out = publicConfig('jira', { filter: { status: ['Open'], apiToken: 'secret-value' } });
    expect(out).toEqual({});
    expect(JSON.stringify(out)).not.toContain('secret-value');
  });

  it('drops a filter that is not a valid shape instead of throwing', () => {
    expect(publicConfig('jira', { filter: 'not-an-object' })).toEqual({});
  });
});

describe('toPublic', () => {
  it('projects the row through publicConfig and includes connectionId', () => {
    const out = toPublic(row());
    expect(out).toMatchObject({
      id: 1,
      name: 'Jira — SpillersTech',
      type: 'jira',
      connectionId: 3,
      configRevision: 1,
      config: { projectKey: 'HELP', filter: { status: ['To Do'] } },
    });
  });

  it('reports connectionId null for an unlinked legacy job', () => {
    const out = toPublic(row({ connectionId: null }));
    expect(out.connectionId).toBeNull();
  });
});

describe('mergeJobConfig', () => {
  it('accepts jql and projectKey for a jira job', () => {
    const next = mergeJobConfig('jira', {}, { projectKey: ' HELP ', jql: 'assignee = x' });
    expect(next).toEqual({ projectKey: 'HELP', jql: 'assignee = x' });
  });

  it('rejects a jira-only field on a connectwise job', () => {
    expect(() => mergeJobConfig('connectwise', {}, { jql: 'x' })).toThrow(SyncProviderValidationError);
    expect(() => mergeJobConfig('connectwise', {}, { jql: 'x' })).toThrow(/unknown config field "jql"/);
  });

  it('normalizes an explicit ConnectWise board', () => {
    expect(mergeJobConfig('connectwise', {}, { board: '  Service Desk  ' }))
      .toEqual({ board: 'Service Desk' });
  });

  it('rejects an unknown field rather than storing it', () => {
    expect(() => mergeJobConfig('jira', {}, { apiToken: 'x' })).toThrow(/unknown config field "apiToken"/);
  });

  it('clears a field when patched with an empty string or null', () => {
    const next = mergeJobConfig('jira', { projectKey: 'HELP', jql: 'assignee = x' }, { jql: '' });
    expect(next).toEqual({ projectKey: 'HELP' });
  });

  it('parses and normalizes filter through the shared vocabulary', () => {
    const next = mergeJobConfig('jira', {}, { filter: { status: [' To Do ', ''] } });
    expect(next.filter).toEqual({ status: ['To Do'] });
  });

  it('rejects a malformed filter rather than storing something matches() cannot use', () => {
    expect(() => mergeJobConfig('jira', {}, { filter: { notAField: ['x'] } })).toThrow(/invalid filter/);
  });

  it('clears the filter entirely when patched to an empty/no-op filter', () => {
    const next = mergeJobConfig('jira', { filter: { status: ['Open'] } }, { filter: {} });
    expect(next).toEqual({});
  });

  it('drops a stray existing key even when the patch never mentions it', () => {
    // `existing` is rebuilt from the current vocabulary, not spread wholesale —
    // a row that somehow picked up a legacy/foreign key must self-heal on the
    // next edit rather than carrying it forward forever.
    const existing = { projectKey: 'HELP', apiToken: 'leaked-secret', board: 'stray-from-other-type' };
    const next = mergeJobConfig('jira', existing, { jql: 'assignee = x' });
    expect(next).toEqual({ projectKey: 'HELP', jql: 'assignee = x' });
  });

  it('re-validates an existing filter carried over untouched by the patch, dropping it if malformed', () => {
    const existing = { filter: { status: ['Open'], apiToken: 'leaked-secret' } };
    const next = mergeJobConfig('jira', existing, { jql: 'assignee = x' });
    expect(next.filter).toBeUndefined();
    expect(JSON.stringify(next)).not.toContain('leaked-secret');
  });

  it('carries over a valid existing filter untouched by the patch', () => {
    const existing = { filter: { status: ['Open'] } };
    const next = mergeJobConfig('jira', existing, { jql: 'assignee = x' });
    expect(next.filter).toEqual({ status: ['Open'] });
  });

  it('preserves unrelated existing keys not touched by the patch', () => {
    const next = mergeJobConfig('jira', { projectKey: 'HELP', jql: 'assignee = x' }, { jql: 'assignee = y' });
    expect(next).toEqual({ projectKey: 'HELP', jql: 'assignee = y' });
  });

  it('rejects an unsupported provider type', () => {
    expect(() => mergeJobConfig('imap', {}, {})).toThrow(/unsupported provider type/);
  });
});

describe('syncScopeChanged', () => {
  it('resets for a different account, query, or filter', () => {
    expect(syncScopeChanged(1, 2, { projectKey: 'HELP' }, { projectKey: 'HELP' })).toBe(true);
    expect(syncScopeChanged(1, 1, { projectKey: 'HELP' }, { projectKey: 'OPS' })).toBe(true);
    expect(
      syncScopeChanged(
        1,
        1,
        { projectKey: 'HELP', filter: { status: ['Open'] } },
        { projectKey: 'HELP', filter: { status: ['Closed'] } }
      )
    ).toBe(true);
  });

  it('does not reset for name/enabled-only edits or a normalized no-op config patch', () => {
    expect(syncScopeChanged(1, 1, { projectKey: 'HELP' }, { projectKey: 'HELP' })).toBe(false);
  });
});
