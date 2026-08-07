import {
  FEEDBACK_RATINGS,
  normalizeFeedbackRating,
  normalizeRegistrationStatus,
  REGISTRATION_STATUSES,
} from './portalVocab';

describe('portal registration vocabulary', () => {
  it('normalizes canonical statuses case-insensitively', () => {
    expect(REGISTRATION_STATUSES).toEqual(['pending', 'approved', 'rejected']);
    expect(normalizeRegistrationStatus(' APPROVED ')).toBe('approved');
  });

  it('rejects unknown values', () => {
    expect(normalizeRegistrationStatus('waiting')).toBeNull();
  });
});

describe('feedback vocabulary', () => {
  it('normalizes canonical ratings case-insensitively', () => {
    expect(FEEDBACK_RATINGS).toEqual(['positive', 'neutral', 'negative']);
    expect(normalizeFeedbackRating(' NEUTRAL ')).toBe('neutral');
  });

  it('rejects unknown ratings', () => {
    expect(normalizeFeedbackRating('excellent')).toBeNull();
  });
});
