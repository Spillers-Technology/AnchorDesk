/**
 * JQL construction tests. The incremental clause is the highest-risk string in
 * the Jira integration: a quoted date literal is reinterpreted in the account's
 * timezone, which silently skipped hours of updates on every run.
 */
import { JiraProvider, splitOrderBy } from '../JiraProvider';
import * as jira from '../../services/jiraService';

jest.mock('../../services/jiraService', () => ({
  ...jest.requireActual('../../services/jiraService'),
  searchIssues: jest.fn(async () => []),
  getMyself: jest.fn(async () => ({ accountId: 'a', displayName: 'Tester' })),
}));

const searchIssues = jira.searchIssues as jest.MockedFunction<typeof jira.searchIssues>;
const getMyself = jira.getMyself as jest.MockedFunction<typeof jira.getMyself>;

const creds: jira.JiraCredentials = {
  baseUrl: 'https://example.atlassian.net',
  email: 'tech@example.com',
  apiToken: 'token',
};

beforeEach(() => {
  searchIssues.mockClear();
  getMyself.mockClear();
  getMyself.mockResolvedValue({ accountId: 'a', displayName: 'Tester' });
});

/** The JQL the provider handed to the search client. */
const lastJql = () => searchIssues.mock.calls[searchIssues.mock.calls.length - 1][1];

describe('fetchTickets JQL', () => {
  it('orders deterministically so token pagination stays stable', async () => {
    await new JiraProvider(creds, 'project = A').fetchTickets();
    expect(lastJql()).toBe('project = A ORDER BY updated ASC, key ASC');
  });

  it('builds a project-scoped default query when only projectKey is given', async () => {
    await new JiraProvider(creds, undefined, null, 'HELP').fetchTickets();
    expect(lastJql()).toBe('project = "HELP" ORDER BY updated ASC, key ASC');
  });

  it('builds the bare default query when neither jql nor projectKey is given', async () => {
    await new JiraProvider(creds).fetchTickets();
    expect(lastJql()).toBe('updated >= 0 ORDER BY updated ASC, key ASC');
  });

  it('does not hide terminal transitions from incremental sync', async () => {
    const since = new Date('2026-07-24T14:00:00.000Z');
    await new JiraProvider(creds, undefined, null, 'HELP').fetchTickets(since);

    expect(lastJql()).toBe(
      `(project = "HELP") AND updated >= ${since.getTime()} ORDER BY updated ASC, key ASC`
    );
    expect(lastJql()).not.toContain('statusCategory != Done');
  });

  // Unquoted epoch milliseconds are timezone-free. The previous
  // `updated >= "YYYY-MM-DD HH:mm"` form was read in the account's own zone,
  // so on a UTC-5 account the cutoff landed 5 hours in the future and the
  // incremental sync returned nothing.
  it('uses unquoted epoch milliseconds for the incremental cutoff', async () => {
    const since = new Date('2026-07-24T14:00:00.000Z');
    await new JiraProvider(creds, 'project = A').fetchTickets(since);

    const jql = lastJql();
    expect(jql).toContain(`updated >= ${since.getTime()}`);
    expect(jql).not.toMatch(/updated >= "/);
    expect(jql).toMatch(/ORDER BY updated ASC, key ASC$/);
  });

  it('strips a caller ORDER BY before appending the cutoff', async () => {
    await new JiraProvider(creds, 'project = A ORDER BY created DESC').fetchTickets(new Date(0));
    const jql = lastJql();
    expect(jql).not.toContain('created DESC');
    expect((jql.match(/ORDER BY/gi) ?? [])).toHaveLength(1);
  });
});

describe('sync filter push-down', () => {
  it('folds status, priority, and project into JQL', async () => {
    await new JiraProvider(creds, 'project = A', {
      status: ['To Do', 'In Progress'],
      priority: ['High'],
      companyName: ['SpillersTech'],
    }).fetchTickets();

    const jql = lastJql();
    expect(jql).toContain('status IN ("To Do", "In Progress")');
    expect(jql).toContain('priority IN ("High")');
    expect(jql).toContain('project IN ("SpillersTech")');
  });

  // Push-down must be a SUPERSET of what the local predicate accepts: a ticket
  // dropped by the remote query can never be recovered locally. JQL's NOT IN
  // skips issues whose field is empty, but the local predicate lets them
  // through, so the clause has to re-admit them. The live SCRUM project has no
  // priority at all, which makes this the difference between 5 issues and 0.
  it('re-admits empty values in exclusions so push-down stays a superset', async () => {
    await new JiraProvider(creds, 'project = A', { exclude: { status: ['Done'] } }).fetchTickets();
    expect(lastJql()).toContain('(status NOT IN ("Done") OR status IS EMPTY)');
  });

  it('agrees with the local predicate for an unset field', async () => {
    const { matches } = await import('../../services/syncFilter');
    // No priority set, excluding "Low": the local predicate accepts it, so the
    // pushed-down JQL must not have filtered it out remotely.
    expect(matches({ priority: undefined }, { exclude: { priority: ['Low'] } })).toBe(true);
    await new JiraProvider(creds, 'project = A', { exclude: { priority: ['Low'] } }).fetchTickets();
    expect(lastJql()).toContain('priority IS EMPTY');
  });

  // Assignee is intentionally not pushed down: JQL wants an accountId while
  // AnchorDesk holds a display name, and a wrong guess drops tickets silently.
  // syncFilter.matches() still enforces it after the fetch.
  it('does not push assignee into JQL', async () => {
    await new JiraProvider(creds, 'project = A', { assignee: ['Joe Spillers'] }).fetchTickets();
    expect(lastJql()).not.toContain('assignee');
  });

  it('keeps ORDER BY last when filters are appended', async () => {
    await new JiraProvider(creds, 'project = A ORDER BY updated DESC', { status: ['To Do'] }).fetchTickets();
    const jql = lastJql();
    expect(jql.indexOf('ORDER BY')).toBeGreaterThan(jql.indexOf('status IN'));
  });

  it('does not push job filters into incremental JQL so existing tickets can leave scope cleanly', async () => {
    const since = new Date('2026-07-24T14:00:00.000Z');
    await new JiraProvider(
      creds,
      'project = A',
      { status: ['To Do'], assignee: ['Alex'] }
    ).fetchTickets(since);

    expect(lastJql()).toBe(
      `(project = A) AND updated >= ${since.getTime()} ORDER BY updated ASC, key ASC`
    );
    expect(lastJql()).not.toContain('status IN');
    expect(lastJql()).not.toContain('assignee');
  });

  it('escapes quotes so a value cannot break out of the clause', async () => {
    await new JiraProvider(creds, 'project = A', { status: ['we"ird'] }).fetchTickets();
    expect(lastJql()).toContain('status IN ("we\\"ird")');
  });

  it('leaves JQL untouched when there is no filter', async () => {
    await new JiraProvider(creds, 'project = A', null).fetchTickets();
    expect(lastJql()).toBe('project = A ORDER BY updated ASC, key ASC');
  });
});

describe('splitOrderBy', () => {
  it('splits a trailing ORDER BY', () => {
    expect(splitOrderBy('project = A ORDER BY updated DESC')).toEqual({
      restriction: 'project = A',
      ordering: 'ORDER BY updated DESC',
    });
  });

  it('returns no ordering when there is none', () => {
    expect(splitOrderBy('project = A')).toEqual({ restriction: 'project = A', ordering: '' });
  });

  // A regex would treat the text inside this value as the clause and truncate
  // the query, silently changing which tickets sync.
  it('ignores ORDER BY appearing inside a quoted value', () => {
    const jql = 'summary ~ "ORDER BY spare parts"';
    expect(splitOrderBy(jql)).toEqual({ restriction: jql, ordering: '' });
  });

  it('handles an escaped quote inside a value', () => {
    const jql = 'summary ~ "say \\"order by\\" twice" ORDER BY key ASC';
    expect(splitOrderBy(jql).ordering).toBe('ORDER BY key ASC');
  });

  it('is case- and whitespace-tolerant', () => {
    expect(splitOrderBy('project = A order   by key').ordering).toBe('order   by key');
  });
});

describe('normalizeIssue', () => {
  it('maps the Jira project to companyName and tolerates missing priority', async () => {
    searchIssues.mockResolvedValueOnce([
      {
        id: '1',
        key: 'SCRUM-4',
        fields: {
          summary: 'Delegate this work item',
          status: { name: 'To Do' },
          project: { name: 'SpillersTech' },
          updated: '2026-07-24T03:54:40.801Z',
        },
      },
    ] as never);

    const [ticket] = await new JiraProvider(creds, 'project = A').fetchTickets();

    expect(ticket.externalId).toBe('SCRUM-4');
    expect(ticket.ticketNumber).toBe('SCRUM-4');
    expect(ticket.companyName).toBe('SpillersTech');
    expect(ticket.status).toBe('To Do');
    // The live SCRUM project has no priority field at all.
    expect(ticket.priority).toBe('');
    expect(ticket.assignee).toBe('');
  });
});

describe('empty-result authentication check', () => {
  // Jira's search endpoint answers 200 {"issues":[],"isLast":true} for an invalid
  // token, a wrong-type token, or no credentials at all — it degrades to
  // anonymous access, which sees nothing in a private project. Verified live.
  // Without this check, broken credentials are indistinguishable from a quiet
  // sync, permanently and silently.
  it('verifies credentials when the result is empty', async () => {
    searchIssues.mockResolvedValueOnce([]);
    await new JiraProvider(creds, 'project = A').fetchTickets();
    expect(getMyself).toHaveBeenCalledTimes(1);
  });

  it('throws when an empty result is actually an auth failure', async () => {
    searchIssues.mockResolvedValueOnce([]);
    getMyself.mockRejectedValueOnce(new Error('Jira GET /rest/api/3/myself \u2192 401: nope'));

    await expect(new JiraProvider(creds, 'project = A').fetchTickets()).rejects.toThrow(
      /credentials failed verification/
    );
  });

  it('does not spend a request verifying when issues came back', async () => {
    searchIssues.mockResolvedValueOnce([
      { id: '1', key: 'A-1', fields: { status: { name: 'To Do' } } },
    ] as never);
    await new JiraProvider(creds, 'project = A').fetchTickets();
    expect(getMyself).not.toHaveBeenCalled();
  });
});
