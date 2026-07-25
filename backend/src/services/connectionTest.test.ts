import { categorize, testConnection } from './connectionTest';

describe('categorize', () => {
  const err = (m: string) => new Error(m);

  it('separates rejected credentials from insufficient permission', () => {
    expect(categorize(err('Jira GET /rest/api/3/myself → 401: nope')).category).toBe('auth');
    expect(categorize(err('Jira GET /rest/api/3/search/jql → 403: denied')).category).toBe('permission');
  });

  // The failure that motivated connection testing: an Atlassian org admin key
  // authenticates but cannot read issues, so the guidance has to name the fix.
  it('explains the org-key-vs-user-token mistake on a 403', () => {
    expect(categorize(err('Jira GET /x → 403: denied')).message).toMatch(/ATATT/);
  });

  it('maps transport failures to unreachable', () => {
    expect(categorize(err('fetch failed')).category).toBe('unreachable');
    expect(categorize(err('The operation was aborted due to timeout')).category).toBe('unreachable');
    expect(categorize(err('getaddrinfo ENOTFOUND bad.host')).category).toBe('unreachable');
    expect(categorize(err('Jira GET /x → 503: down')).category).toBe('unreachable');
  });

  it('maps a wrong site URL to not_found', () => {
    expect(categorize(err('Jira GET /x → 404: missing')).category).toBe('not_found');
  });

  // Remote bodies can echo request headers, so they must never be surfaced.
  it('never leaks the remote response body', () => {
    const out = categorize(err('Jira GET /x → 418: {"authorization":"Basic c2VjcmV0"}'));
    expect(out.message).not.toContain('c2VjcmV0');
    expect(out.category).toBe('unknown');
  });
});

describe('testConnection', () => {
  it('reports incomplete credentials without making a request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const res = await testConnection('jira', { baseUrl: 'https://x.atlassian.net', email: 'a@b.c' });

    expect(res.ok).toBe(false);
    expect(res.category).toBe('incomplete');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('admits that ConnectWise testing is not implemented rather than claiming success', async () => {
    const res = await testConnection('connectwise', {
      server: 's', company: 'c', publicKey: 'p', privateKey: 'k', clientId: 'i',
    });
    expect(res.ok).toBe(false);
    expect(res.category).toBe('unsupported');
  });
});

describe('testJira project visibility', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  const creds = { baseUrl: 'https://x.atlassian.net', email: 'a@b.c', apiToken: 't' };
  const respond = (map: Record<string, unknown>) => {
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      const u = String(url);
      const key = Object.keys(map).find((k) => u.includes(k))!;
      return { ok: true, status: 200, text: async () => JSON.stringify(map[key]) } as Response;
    }) as unknown as typeof fetch;
  };

  it('reports connected with the visible projects', async () => {
    respond({
      '/myself': { displayName: 'Joseph Spillers', accountId: 'a1' },
      '/project/search': { values: [{ key: 'SCRUM' }] },
    });
    const r = await testConnection('jira', creds);
    expect(r.ok).toBe(true);
    expect(r.identity).toBe('Joseph Spillers');
    expect(r.message).toContain('SCRUM');
  });

  // Authenticating is not the same as being able to read anything. A token that
  // sees no projects would sync silently forever, which is the exact failure
  // this whole feature exists to prevent.
  it('fails when the account authenticates but sees no projects', async () => {
    respond({
      '/myself': { displayName: 'Joseph Spillers', accountId: 'a1' },
      '/project/search': { values: [] },
    });
    const r = await testConnection('jira', creds);
    expect(r.ok).toBe(false);
    expect(r.category).toBe('permission');
    expect(r.message).toMatch(/no projects are visible/);
  });
});
