import {
  CustomFieldValidationError,
  coerceCustomFieldFilters,
  validateCustomFieldValues,
} from './customFields';

const defs = [
  { key: 'site', label: 'Site', type: 'text', options: null, required: true, archived: false },
  { key: 'seats', label: 'Seats', type: 'number', options: null, required: false, archived: false },
  { key: 'managed', label: 'Managed', type: 'boolean', options: null, required: false, archived: false },
  { key: 'renewal', label: 'Renewal', type: 'date', options: null, required: false, archived: false },
  { key: 'tier', label: 'Tier', type: 'select', options: ['Gold', 'Silver'], required: false, archived: false },
  { key: 'legacy', label: 'Legacy', type: 'text', options: null, required: false, archived: true },
] as unknown as Parameters<typeof validateCustomFieldValues>[0];

describe('validateCustomFieldValues', () => {
  it('normalizes supported field types', () => {
    expect(validateCustomFieldValues(defs, {
      site: '  Indianapolis  ',
      seats: '12',
      managed: 'false',
      renewal: '2027-02-28',
      tier: 'Gold',
    })).toEqual({
      site: 'Indianapolis',
      seats: 12,
      managed: false,
      renewal: '2027-02-28',
      tier: 'Gold',
    });
  });

  it('uses null as the normalized clear operation', () => {
    expect(validateCustomFieldValues(defs, { seats: '', managed: null })).toEqual({ seats: null, managed: null });
  });

  it.each([
    [{ surprise: 'x' }, 'Unknown custom field'],
    [{ legacy: 'x' }, 'is archived'],
    [{ seats: 'many' }, 'must be a number'],
    [{ managed: 'yes' }, 'must be true or false'],
    [{ renewal: '2027-02-30' }, 'must be a YYYY-MM-DD date'],
    [{ tier: 'Bronze' }, 'must be one of'],
    [{ site: '   ' }, 'is required'],
  ])('rejects invalid input %#', (values, message) => {
    expect(() => validateCustomFieldValues(defs, values)).toThrow(message);
  });

  it('rejects arrays and null instead of treating them as field maps', () => {
    expect(() => validateCustomFieldValues(defs, [] as unknown as Record<string, unknown>)).toThrow(CustomFieldValidationError);
    expect(() => validateCustomFieldValues(defs, null as unknown as Record<string, unknown>)).toThrow('must be an object');
  });
});

describe('coerceCustomFieldFilters', () => {
  const filterDefs = defs as unknown as Parameters<typeof coerceCustomFieldFilters>[0];

  it('coerces query-string and typed values per definition type', () => {
    expect(coerceCustomFieldFilters(filterDefs, { seats: '12', managed: 'true', site: 'HQ' }))
      .toEqual({ seats: 12, managed: true, site: 'HQ' });
    expect(coerceCustomFieldFilters(filterDefs, { seats: 12, managed: false }))
      .toEqual({ seats: 12, managed: false });
  });

  it('accepts archived fields — archiving preserves ticket data, so filters over it keep working', () => {
    expect(coerceCustomFieldFilters(filterDefs, { legacy: 'old-value' })).toEqual({ legacy: 'old-value' });
  });

  it.each([
    [{ surprise: 'x' }, 'unknown custom field'],
    [{ seats: 'many' }, 'must be a number'],
    [{ managed: 'yep' }, 'must be true or false'],
    [{ site: ['a', 'b'] }, 'single string value'],
    [{ site: '' }, 'single string value'],
  ])('rejects uncoercible filter input %#', (input, message) => {
    expect(() => coerceCustomFieldFilters(filterDefs, input as Record<string, unknown>)).toThrow(message);
  });
});
