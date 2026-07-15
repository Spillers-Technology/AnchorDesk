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
      includeClosed: true,
    })).toEqual({
      status: 'Open',
      assignee: 'Alice',
      company: 'Acme',
      q: 'printer',
      regex: 'print(er|ing)',
      labelId: 2,
      teamId: 3,
      includeClosed: true,
    });
  });

  it.each([
    [[], 'filters must be an object'],
    [{ mystery: true }, 'Unsupported saved-view filter'],
    [{ teamId: 0 }, 'teamId must be a positive integer'],
    [{ includeClosed: 'yes' }, 'includeClosed must be a boolean'],
  ])('rejects invalid filters %#', (filters, message) => {
    expect(() => normalizeSavedViewFilters(filters)).toThrow(message);
  });

  it('uses a dedicated validation error for route-level 400 responses', () => {
    expect(() => normalizeSavedViewFilters(null)).toThrow(SavedViewValidationError);
  });
});
