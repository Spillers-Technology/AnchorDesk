/**
 * Unit tests for the two-way sync fingerprint — the primitive conflict detection
 * relies on. DB-free: fingerprint() is pure over the field set.
 */
import { fingerprint } from '../twoWaySync';

describe('twoWaySync.fingerprint', () => {
  const base = { status: 'Open', priority: 'High', assignee: 'alice', title: 'Printer down', description: 'jammed' };

  it('is stable for identical field sets', () => {
    expect(fingerprint(base)).toBe(fingerprint({ ...base }));
  });

  it('ignores surrounding whitespace', () => {
    expect(fingerprint(base)).toBe(fingerprint({ ...base, status: '  Open  ', title: 'Printer down ' }));
  });

  it('changes when any tracked field changes', () => {
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, status: 'Closed' }));
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, priority: 'Low' }));
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, assignee: 'bob' }));
  });

  it('treats undefined and empty string alike', () => {
    expect(fingerprint({ status: 'Open' })).toBe(fingerprint({ status: 'Open', priority: '', assignee: undefined }));
  });

  it('returns a 64-char hex sha256', () => {
    expect(fingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
