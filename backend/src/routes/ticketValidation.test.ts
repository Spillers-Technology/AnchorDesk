import { validateTicketInput } from './tickets';

describe('validateTicketInput dueAt', () => {
  it('accepts an ISO 8601 datetime string', () => {
    expect(validateTicketInput({ dueAt: '2026-07-20T17:00:00.000Z' }, false)).toBeNull();
    expect(validateTicketInput({ dueAt: '2026-07-20T12:00:00-05:00' }, false)).toBeNull();
  });

  it('accepts null to clear the deadline (falls back to SLA)', () => {
    expect(validateTicketInput({ dueAt: null }, false)).toBeNull();
  });

  it('accepts an absent dueAt', () => {
    expect(validateTicketInput({ status: 'Open' }, false)).toBeNull();
  });

  it('rejects unparseable strings and non-string values', () => {
    expect(validateTicketInput({ dueAt: 'not a date' }, false)).toMatch(/dueAt/);
    expect(validateTicketInput({ dueAt: 1234567890 }, false)).toMatch(/dueAt/);
    expect(validateTicketInput({ dueAt: { when: 'later' } }, false)).toMatch(/dueAt/);
  });

  it('still enforces title on create alongside dueAt', () => {
    expect(validateTicketInput({ dueAt: '2026-07-20T17:00:00Z' }, true)).toMatch(/title/);
    expect(validateTicketInput({ title: 'x', dueAt: '2026-07-20T17:00:00Z' }, true)).toBeNull();
  });
});
