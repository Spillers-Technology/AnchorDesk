/**
 * Contract tests for the Jira client. The pagination and ADF behaviour here are
 * the two places where a silent wrong answer (a short result list, a mangled
 * description) would corrupt sync state rather than raise an error.
 */
import { fromADF, JiraCredentials, listComments, redactRemoteBody, searchIssues, toADF } from './jiraService';

const creds: JiraCredentials = {
  baseUrl: 'https://example.atlassian.net',
  email: 'tech@example.com',
  apiToken: 'token',
};

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

/** Queue up canned JSON responses in order. */
function mockFetchSequence(pages: unknown[]) {
  const calls: string[] = [];
  let i = 0;
  global.fetch = jest.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    const body = pages[Math.min(i, pages.length - 1)];
    i++;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe('toADF / fromADF', () => {
  // This round-trip is load-bearing: two-way sync verifies a pushed description
  // by re-reading it and comparing. When fromADF concatenated paragraph text,
  // "a\n\nb" came back as "ab" and every multi-paragraph push looked failed.
  it('round-trips multi-paragraph text', () => {
    const text = 'first para\n\nsecond para';
    expect(fromADF(toADF(text))).toBe(text);
  });

  it('round-trips single-paragraph text', () => {
    expect(fromADF(toADF('just one line'))).toBe('just one line');
  });

  it('preserves paragraph boundaries from inbound Jira documents', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      ],
    };
    expect(fromADF(adf)).toBe('one\n\ntwo');
  });

  it('handles legacy strings, null, and hard breaks', () => {
    expect(fromADF(null)).toBe('');
    expect(fromADF('plain')).toBe('plain');
    const adf = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }],
    };
    expect(fromADF(adf)).toBe('a\nb');
  });
});

describe('searchIssues', () => {
  it('walks every page until isLast and requests fields explicitly', async () => {
    const calls = mockFetchSequence([
      { issues: [{ id: '1', key: 'A-1', fields: {} }], nextPageToken: 't1', isLast: false },
      { issues: [{ id: '2', key: 'A-2', fields: {} }], nextPageToken: 't2', isLast: false },
      { issues: [{ id: '3', key: 'A-3', fields: {} }], isLast: true },
    ]);

    const issues = await searchIssues(creds, 'project = A');

    expect(issues.map((i) => i.key)).toEqual(['A-1', 'A-2', 'A-3']);
    expect(calls).toHaveLength(3);
    // The endpoint returns only `id` unless fields are named.
    expect(calls[0]).toContain('fields=summary');
    expect(calls[0]).toContain('/rest/api/3/search/jql');
    expect(calls[0]).not.toContain('nextPageToken');
    expect(calls[1]).toContain('nextPageToken=t1');
    expect(calls[2]).toContain('nextPageToken=t2');
  });

  it('stops when the token disappears even if isLast is absent', async () => {
    mockFetchSequence([{ issues: [{ id: '1', key: 'A-1', fields: {} }] }]);
    await expect(searchIssues(creds, 'project = A')).resolves.toHaveLength(1);
  });

  it('de-duplicates issues that shift between pages mid-walk', async () => {
    mockFetchSequence([
      { issues: [{ id: '1', key: 'A-1', fields: {} }], nextPageToken: 't1', isLast: false },
      { issues: [{ id: '1', key: 'A-1', fields: {} }, { id: '2', key: 'A-2', fields: {} }], isLast: true },
    ]);
    const issues = await searchIssues(creds, 'project = A');
    expect(issues.map((i) => i.key)).toEqual(['A-1', 'A-2']);
  });

  // Returning a partial list would let the caller advance its sync watermark
  // past issues it never saw, so a stalled walk must be an error.
  it('throws when the page token repeats instead of looping', async () => {
    mockFetchSequence([{ issues: [{ id: '1', key: 'A-1', fields: {} }], nextPageToken: 'same', isLast: false }]);
    await expect(searchIssues(creds, 'project = A')).rejects.toThrow(/paging stalled/);
  });

  it('surfaces an HTTP error rather than returning an empty list', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 410,
      text: async () => '{"errorMessages":["The requested API has been removed."]}',
    })) as unknown as typeof fetch;

    await expect(searchIssues(creds, 'project = A')).rejects.toThrow(/410/);
  });
});

describe('listComments', () => {
  it('pages by the number of rows actually returned, not the number requested', async () => {
    // Jira may cap maxResults below the request; advancing by the requested size
    // would skip the difference on every page.
    const calls = mockFetchSequence([
      { comments: [{ id: '1' }, { id: '2' }], startAt: 0, maxResults: 2, total: 3 },
      { comments: [{ id: '3' }], startAt: 2, maxResults: 2, total: 3 },
    ]);

    const comments = await listComments(creds, 'A-1');

    expect(comments.map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(calls[0]).toContain('startAt=0');
    expect(calls[1]).toContain('startAt=2');
  });

  it('stops on an empty page', async () => {
    mockFetchSequence([{ comments: [], total: 0 }]);
    await expect(listComments(creds, 'A-1')).resolves.toEqual([]);
  });
});

describe('redactRemoteBody', () => {
  // Remote error bodies flow into sync_log, manual-run responses, and server
  // logs. A wrong or hostile baseUrl receives the Basic auth header and can
  // echo the whole request back.
  it('redacts an echoed Basic auth header', () => {
    const out = redactRemoteBody('{"error":"bad","headers":{"authorization":"Basic aGVscEB4OkFUQVRU"}}');
    expect(out).not.toContain('aGVscEB4OkFUQVRU');
    expect(out).toContain('[redacted]');
  });

  it('redacts a bare Atlassian token', () => {
    const out = redactRemoteBody('token ATATT3xFfGF0AbCdEfGhIjKlMnOpQrSt was rejected');
    expect(out).not.toContain('ATATT3xFfGF0AbCdEfGhIjKlMnOpQrSt');
  });

  it('redacts labelled credential fields', () => {
    expect(redactRemoteBody('{"apiToken":"hunter2"}')).not.toContain('hunter2');
    expect(redactRemoteBody('password=hunter2')).not.toContain('hunter2');
  });

  it('keeps ordinary diagnostic text and bounds the length', () => {
    expect(redactRemoteBody('{"errorMessages":["Issue does not exist"]}')).toContain('Issue does not exist');
    expect(redactRemoteBody('x'.repeat(5000)).length).toBeLessThanOrEqual(400);
  });
});
