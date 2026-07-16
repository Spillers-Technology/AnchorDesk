import { normalizeSavedViewFilters, SavedViewValidationError } from './savedViewRepository';

describe('normalizeSavedViewFilters', () => {
  it('accepts the complete replayable ticket-filter surface', () => {
    expect(normalizeSavedViewFilters({
      status: 'Open',
      assignee: 'Alice',
      company: 'Acme',
      q: 'printer',
      regex: 'print(er|ing)',
      labelId: 2,
      teamId: 3,
      customFields: { site: 'HQ', seats: 12, vip: true },
      includeClosed: true,
    })).toEqual({
      status: 'Open',
      assignee: 'Alice',
      company: 'Acme',
      q: 'printer',
      regex: 'print(er|ing)',
      labelId: 2,
      teamId: 3,
      customFields: { site: 'HQ', seats: 12, vip: true },
      includeClosed: true,
    });
  });

  it.each([
    [[], 'filters must be an object'],
    [{ mystery: true }, 'Unsupported saved-view filter'],
    [{ teamId: 0 }, 'teamId must be a positive integer'],
    [{ customFields: [] }, 'customFields must be an object'],
    [{ customFields: { 'Bad key': 'x' } }, 'invalid custom field key'],
    [{ customFields: { site: null } }, 'must be a string, number, or boolean'],
    [{ includeClosed: 'yes' }, 'includeClosed must be a boolean'],
  ])('rejects invalid filters %#', (filters, message) => {
    expect(() => normalizeSavedViewFilters(filters)).toThrow(message);
  });

  it('uses a dedicated validation error for route-level 400 responses', () => {
    expect(() => normalizeSavedViewFilters(null)).toThrow(SavedViewValidationError);
  });
});
