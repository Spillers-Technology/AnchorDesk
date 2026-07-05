/**
 * Contract tests for the Datto RMM device normalizer. Guards the mapping from
 * Datto's device shape onto our ExternalDevice, including online/offline status,
 * category collapsing, and lastSeen coercion. DB-free — normalize() is pure.
 */
import { DattoRmmProvider } from '../DattoRmmProvider';

const provider = new DattoRmmProvider();

describe('DattoRmmProvider.normalize', () => {
  it('maps canonical fields', () => {
    const d = provider.normalize({
      uid: 'dev-uid-1',
      hostname: 'ACME-WS-9',
      description: 'Reception PC',
      intIpAddress: '192.168.1.50',
      extIpAddress: '203.0.113.5',
      operatingSystem: 'Windows 11 Pro',
      deviceType: { category: 'Desktop', type: 'Windows' },
      online: true,
      lastSeen: 1_700_000_000_000,
      siteName: 'ACME HQ',
    });
    expect(d.externalId).toBe('dev-uid-1');
    expect(d.hostname).toBe('ACME-WS-9');
    expect(d.displayName).toBe('Reception PC');
    expect(d.ipAddress).toBe('192.168.1.50');
    expect(d.os).toBe('Windows 11 Pro');
    expect(d.deviceType).toBe('workstation');
    expect(d.status).toBe('online');
    expect(d.companyName).toBe('ACME HQ');
    expect(d.lastSeenAt).toEqual(new Date(1_700_000_000_000));
    expect(d.metadata?.extIpAddress).toBe('203.0.113.5');
  });

  it('normalizes online/offline/unknown status', () => {
    expect(provider.normalize({ uid: 'a', online: true }).status).toBe('online');
    expect(provider.normalize({ uid: 'b', online: false }).status).toBe('offline');
    expect(provider.normalize({ uid: 'c' }).status).toBe('unknown');
  });

  it('collapses device categories', () => {
    expect(provider.normalize({ uid: 'a', deviceType: { category: 'Server' } }).deviceType).toBe('server');
    expect(provider.normalize({ uid: 'b', deviceType: { category: 'Laptop' } }).deviceType).toBe('workstation');
  });

  it('coerces string lastSeen (epoch or ISO)', () => {
    expect(provider.normalize({ uid: 'a', lastSeen: '1700000000000' }).lastSeenAt).toEqual(new Date(1_700_000_000_000));
    expect(provider.normalize({ uid: 'b', lastSeen: '2023-11-14T22:13:20.000Z' }).lastSeenAt).toEqual(
      new Date('2023-11-14T22:13:20.000Z')
    );
  });

  it('throws when the device has no uid', () => {
    expect(() => provider.normalize({ hostname: 'ghost' })).toThrow();
  });
});
