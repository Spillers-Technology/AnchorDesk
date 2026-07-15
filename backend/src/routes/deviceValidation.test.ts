import { Prisma } from '@prisma/client';
import {
  DevicePayloadValidationError,
  hasLegacyIdentityMutation,
  normalizeExternalProvider,
  normalizeRmmProvider,
  validateDevicePayload,
  validateExternalRefPayload,
} from './deviceValidation';

describe('device payload validation', () => {
  it('accepts and normalizes documented asset fields', () => {
    const input = validateDevicePayload({
      assetTag: '  A-100  ',
      serialNumber: ' SN-42 ',
      manufacturer: ' Framework ',
      model: ' Laptop 13 ',
      vendor: ' Framework ',
      location: ' Bench 2 ',
      purchaseDate: '2026-07-15',
      warrantyExpiresAt: null,
      notes: ' field unit ',
      companyId: 7,
    }, 'patch');

    expect(input).toMatchObject({
      assetTag: 'A-100',
      serialNumber: 'SN-42',
      manufacturer: 'Framework',
      model: 'Laptop 13',
      vendor: 'Framework',
      location: 'Bench 2',
      warrantyExpiresAt: null,
      notes: 'field unit',
      companyId: 7,
    });
    expect(input.purchaseDate).toEqual(new Date('2026-07-15T00:00:00.000Z'));
  });

  it('rejects unknown, mistyped, and invalid date fields', () => {
    expect(() => validateDevicePayload({ createdAt: '2026-01-01' }, 'patch'))
      .toThrow('Unsupported device field: createdAt');
    expect(() => validateDevicePayload({ assetTag: 42 }, 'patch'))
      .toThrow('assetTag must be a string or null');
    expect(() => validateDevicePayload({ purchaseDate: '2026-02-30' }, 'patch'))
      .toThrow('purchaseDate must be a real calendar date');
  });

  it('requires paired legacy identity and keeps source consistent', () => {
    expect(() => validateDevicePayload({ externalId: 'agent-1' }, 'patch'))
      .toThrow('externalId and externalProvider must be supplied together');

    expect(validateDevicePayload({
      externalId: ' agent-1 ',
      externalProvider: 'Tactical-RMM',
    }, 'patch')).toMatchObject({
      externalId: 'agent-1',
      externalProvider: 'tactical_rmm',
      source: 'tactical_rmm',
    });

    expect(validateDevicePayload({ externalId: null, externalProvider: null }, 'patch'))
      .toMatchObject({ externalId: null, externalProvider: null, source: 'local' });
    expect(() => validateDevicePayload({ source: 'ninjaone' }, 'patch'))
      .toThrow('externalId and externalProvider are required');
  });

  it('maps JSON null to database null and validates port arrays', () => {
    const cleared = validateDevicePayload({ metadata: null, openPorts: null }, 'patch');
    expect(cleared.metadata).toBe(Prisma.DbNull);
    expect(cleared.openPorts).toBe(Prisma.DbNull);

    expect(validateDevicePayload({ openPorts: [22, { port: 443, service: 'https' }] }, 'patch').openPorts)
      .toEqual([22, { port: 443, service: 'https' }]);
    expect(() => validateDevicePayload({ openPorts: [70_000] }, 'patch'))
      .toThrow('openPorts entries must be port numbers');
    expect(() => validateDevicePayload({ metadata: ['not-an-object'] }, 'patch'))
      .toThrow('metadata must be a JSON object or null');
  });

  it('identifies every legacy identity mutation for dynamic RBAC', () => {
    expect(hasLegacyIdentityMutation({ externalProvider: 'ninjaone' })).toBe(true);
    expect(hasLegacyIdentityMutation({ externalId: null })).toBe(true);
    expect(hasLegacyIdentityMutation({ source: 'local' })).toBe(true);
    expect(hasLegacyIdentityMutation({ assetTag: 'A-1' })).toBe(false);
  });
});

describe('external reference validation', () => {
  it('canonicalizes known providers and validates the full payload', () => {
    expect(normalizeExternalProvider(' Datto RMM ')).toBe('datto_rmm');
    expect(normalizeRmmProvider('Ninja-One')).toBe('ninjaone');
    expect(validateExternalRefPayload({
      provider: 'TRMM',
      externalId: ' agent-7 ',
      metadata: { site: 'HQ' },
      lastSeenAt: '2026-07-15T12:30:00Z',
    })).toMatchObject({
      provider: 'tactical_rmm',
      externalId: 'agent-7',
      metadata: { site: 'HQ' },
      lastSeenAt: new Date('2026-07-15T12:30:00Z'),
    });
  });

  it('rejects unknown providers, unknown fields, and invalid metadata', () => {
    expect(() => validateExternalRefPayload({ provider: 'other', externalId: 'x' }))
      .toThrow(DevicePayloadValidationError);
    expect(() => validateExternalRefPayload({ provider: 'ninjaone', externalId: 'x', deviceId: 1 }))
      .toThrow('Unsupported external reference field: deviceId');
    expect(() => validateExternalRefPayload({ provider: 'ninjaone', externalId: 'x', metadata: [] }))
      .toThrow('metadata must be a JSON object or null');
  });
});
