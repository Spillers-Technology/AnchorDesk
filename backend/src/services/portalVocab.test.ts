import { normalizeRegistrationStatus, REGISTRATION_STATUSES } from './portalVocab';

describe('portal registration vocabulary', () => {
  it('normalizes canonical statuses case-insensitively', () => {
    expect(REGISTRATION_STATUSES).toEqual(['pending', 'approved', 'rejected']);
    expect(normalizeRegistrationStatus(' APPROVED ')).toBe('approved');
  });

  it('rejects unknown values', () => {
    expect(normalizeRegistrationStatus('waiting')).toBeNull();
  });
});
