/**
 * Contract tests for the netviz device normalizer. This file owns the wire
 * contract with the netviz probe — these assertions guard the field aliases and
 * status/port normalization that the two projects agreed on (contract v1).
 */
import { NetVizProvider, NETVIZ_CONTRACT_VERSION } from '../NetVizProvider';

const provider = new NetVizProvider('ACME Corp');

describe('NetVizProvider.normalize', () => {
  it('maps canonical field names', () => {
    const d = provider.normalize({
      id: 'abc',
      ip: '192.168.1.20',
      hostname: 'ACME-PC-01',
      mac: 'aa:bb:cc:dd:ee:ff',
      vendor: 'Dell',
      os: 'Windows 11',
      deviceType: 'workstation',
      openPorts: [22, 445, 3389],
      status: 'up',
    });
    expect(d.externalId).toBe('abc');
    expect(d.ipAddress).toBe('192.168.1.20');
    expect(d.hostname).toBe('ACME-PC-01');
    expect(d.macAddress).toBe('aa:bb:cc:dd:ee:ff');
    expect(d.deviceType).toBe('workstation');
    expect(d.openPorts).toEqual([22, 445, 3389]);
    expect(d.status).toBe('online');
    expect(d.companyName).toBe('ACME Corp');
  });

  it('tolerates field aliases (ipAddress/name/macAddress/manufacturer/classification/ports/state)', () => {
    const d = provider.normalize({
      ipAddress: '10.0.0.5',
      name: 'host5',
      macAddress: '11:22:33:44:55:66',
      manufacturer: 'HP',
      classification: 'printer',
      ports: [{ port: 9100 }, { port: 80 }],
      state: 'offline',
    });
    expect(d.ipAddress).toBe('10.0.0.5');
    expect(d.hostname).toBe('host5');
    expect(d.vendor).toBe('HP');
    expect(d.deviceType).toBe('printer');
    expect(d.openPorts).toEqual([9100, 80]);
    expect(d.status).toBe('offline');
  });

  it('falls back id → mac → ip', () => {
    expect(provider.normalize({ mac: 'de:ad:be:ef:00:01', ip: '1.2.3.4' }).externalId).toBe('de:ad:be:ef:00:01');
    expect(provider.normalize({ ip: '1.2.3.4' }).externalId).toBe('1.2.3.4');
  });

  it('throws when there is no id/mac/ip to key on', () => {
    expect(() => provider.normalize({ hostname: 'ghost' })).toThrow();
  });

  it('normalizes status synonyms and unknowns', () => {
    expect(provider.normalize({ id: 'a', status: 'online' }).status).toBe('online');
    expect(provider.normalize({ id: 'b', status: 'down' }).status).toBe('offline');
    expect(provider.normalize({ id: 'c', status: 'weird' }).status).toBe('unknown');
    expect(provider.normalize({ id: 'd' }).status).toBe('unknown');
  });

  it('pins the contract version', () => {
    expect(NETVIZ_CONTRACT_VERSION).toBe(1);
  });
});
