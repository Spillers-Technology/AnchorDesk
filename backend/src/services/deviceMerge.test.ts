import {
  macIdentityVariants,
  mergeExternalObservation,
  monotonicTimestampPatch,
  normalizeCompanyName,
  sameCompanyIdentity,
  serialIdentityValue,
} from './deviceMerge';

describe('deviceMerge', () => {
  it('normalizes common MAC address spellings for identity matching', () => {
    expect(macIdentityVariants('AA-BB-CC-DD-EE-FF')).toEqual([
      'aa:bb:cc:dd:ee:ff',
      'aa-bb-cc-dd-ee-ff',
      'aabbccddeeff',
    ]);
    expect(macIdentityVariants('00:00:00:00:00:00')).toEqual([]);
    expect(macIdentityVariants('FF-FF-FF-FF-FF-FF')).toEqual([]);
    expect(macIdentityVariants('unknown')).toEqual([]);
  });

  it('rejects generic provider serial placeholders as physical identities', () => {
    expect(serialIdentityValue(' To Be Filled By O.E.M. ')).toBeUndefined();
    expect(serialIdentityValue('000000000000')).toBeUndefined();
    expect(serialIdentityValue('FF-FF-FF-FF')).toBeUndefined();
    expect(serialIdentityValue('REAL-SERIAL-001')).toBe('REAL-SERIAL-001');
  });

  it('refreshes telemetry from the same provider without overwriting local asset data', () => {
    const patch = mergeExternalObservation(
      {
        hostname: 'old-host',
        serialNumber: 'LOCAL-SERIAL',
        model: 'Operator model',
        status: 'offline',
        lastSeenAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        hostname: 'new-host',
        serialNumber: 'RMM-SERIAL',
        model: 'RMM model',
        status: 'online',
        lastSeenAt: new Date('2026-01-02T00:00:00Z'),
      },
      true,
    );

    expect(patch).toMatchObject({
      hostname: 'new-host',
      status: 'online',
      lastSeenAt: new Date('2026-01-02T00:00:00Z'),
    });
    expect(patch.serialNumber).toBeUndefined();
    expect(patch.model).toBeUndefined();
  });

  it('only fills shared blanks when a second provider observes the same device', () => {
    const patch = mergeExternalObservation(
      {
        hostname: 'primary-host',
        ipAddress: null,
        manufacturer: null,
        status: 'offline',
      },
      {
        hostname: 'secondary-host',
        ipAddress: '10.0.0.5',
        manufacturer: 'Framework',
        status: 'online',
      },
      false,
    );

    expect(patch.hostname).toBeUndefined();
    expect(patch.ipAddress).toBe('10.0.0.5');
    expect(patch.manufacturer).toBe('Framework');
    expect(patch.status).toBeUndefined();
  });

  it('keeps a secondary provider fill-only on every subsequent sync', () => {
    const patch = mergeExternalObservation(
      {
        hostname: 'primary-host',
        ipAddress: '10.0.0.5',
        status: 'offline',
        firstSeenAt: new Date('2026-01-02T00:00:00Z'),
        lastSeenAt: new Date('2026-01-03T00:00:00Z'),
      },
      {
        hostname: 'secondary-host',
        ipAddress: '10.0.0.99',
        status: 'online',
        firstSeenAt: new Date('2025-12-01T00:00:00Z'),
        lastSeenAt: new Date('2026-02-01T00:00:00Z'),
      },
      false,
    );

    expect(patch).toEqual({});
  });

  it('only extends provider observation windows', () => {
    expect(monotonicTimestampPatch(
      {
        firstSeenAt: '2026-01-02T00:00:00Z',
        lastSeenAt: '2026-01-03T00:00:00Z',
      },
      {
        firstSeenAt: '2026-01-01T00:00:00Z',
        lastSeenAt: '2026-01-04T00:00:00Z',
      },
    )).toEqual({
      firstSeenAt: new Date('2026-01-01T00:00:00Z'),
      lastSeenAt: new Date('2026-01-04T00:00:00Z'),
    });

    expect(monotonicTimestampPatch(
      {
        firstSeenAt: '2026-01-02T00:00:00Z',
        lastSeenAt: '2026-01-03T00:00:00Z',
      },
      {
        firstSeenAt: '2026-01-03T00:00:00Z',
        lastSeenAt: '2026-01-02T00:00:00Z',
      },
    )).toEqual({});
  });

  it('matches company identity by id or normalized provider name', () => {
    expect(normalizeCompanyName('  Acme\t  NORTH  ')).toBe('acme north');
    expect(sameCompanyIdentity(
      { companyId: 12, companyName: 'Old label' },
      { companyId: 12, companyName: 'New label' },
    )).toBe(true);
    expect(sameCompanyIdentity(
      { companyId: null, companyName: 'Acme   North' },
      { companyId: 12, companyName: ' acme north ' },
    )).toBe(true);
    expect(sameCompanyIdentity(
      { companyId: 13, companyName: 'Other tenant' },
      { companyId: 12, companyName: 'Acme North' },
    )).toBe(false);
    expect(sameCompanyIdentity(
      { companyId: 13, companyName: 'Acme North' },
      { companyId: 12, companyName: ' acme north ' },
    )).toBe(false);
  });
});
