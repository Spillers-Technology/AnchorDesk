import { normalizePriority, normalizeStatus } from './ticketVocab';
import { validateTicketInput } from '../routes/tickets';

describe('ticket vocabulary normalization', () => {
  it('canonicalizes case-insensitive matches', () => {
    expect(normalizeStatus('in progress')).toBe('In Progress');
    expect(normalizeStatus('CLOSED')).toBe('Closed');
    expect(normalizePriority('critical')).toBe('Critical');
    expect(normalizePriority(' Medium ')).toBe('Medium');
  });

  it('returns null for statuses that were never in the vocabulary', () => {
    // "Open" was the historic MCP-description example and is NOT a status.
    expect(normalizeStatus('Open')).toBeNull();
    expect(normalizeStatus('open')).toBeNull();
    expect(normalizePriority('3')).toBeNull();
    expect(normalizePriority('Urgent')).toBeNull();
  });
});

describe('route validation enforces the vocabulary on local writes', () => {
  it('canonicalizes valid values in place', () => {
    const body: Record<string, unknown> = { title: 'x', status: 'waiting', priority: 'HIGH' };
    expect(validateTicketInput(body, true)).toBeNull();
    expect(body.status).toBe('Waiting');
    expect(body.priority).toBe('High');
  });

  it('rejects unknown values with the valid list', () => {
    expect(validateTicketInput({ status: 'Open' }, false)).toMatch(/status must be one of: New, Assigned/);
    expect(validateTicketInput({ priority: '3' }, false)).toMatch(/priority must be one of: Low, Medium/);
  });
});
