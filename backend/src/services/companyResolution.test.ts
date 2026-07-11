import { companyFromEmail } from './companyResolution';

describe('companyFromEmail', () => {
  it('normalizes a sender domain and derives a readable company name', () => {
    expect(companyFromEmail('Alerts@north-star.example')).toEqual({
      name: 'North Star',
      domain: 'north-star.example',
    });
  });

  it('rejects missing and malformed addresses', () => {
    expect(companyFromEmail(undefined)).toBeNull();
    expect(companyFromEmail('not-an-address')).toBeNull();
    expect(companyFromEmail('person@localhost')).toBeNull();
  });
});
