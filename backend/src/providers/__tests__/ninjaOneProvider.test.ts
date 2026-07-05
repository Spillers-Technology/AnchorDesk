/**
 * Contract tests for the NinjaOne device normalizer. Guards the field mapping
 * from NinjaOne's device shape onto our ExternalDevice, plus the status and
 * node-class collapsing. DB-free — normalize() is pure over the raw payload.
 */
import { NinjaOneProvider } from '../NinjaOneProvider';

const provider = new NinjaOneProvider();

describe('NinjaOneProvider.normalize', () => {
  it('maps canonical fields and epoch lastContact', () => {
    const d = provider.normalize({
      id: 42,
      organizationId: 7,
      systemName: 'ACME-SRV-01',
      nodeClass: 'WINDOWS_SERVER',
      offline: false,
      lastContact: 1_700_000_000,
      ipAddresses: ['192.168.1.10', '10.0.0.2'],
      system: { manufacturer: 'Dell', model: 'PowerEdge', serialNumber: 'SN123' },
      os: { name: 'Windows Server 2022' },
    });
    expect(d.externalId).toBe('42');
    expect(d.hostname).toBe('ACME-SRV-01');
    expect(d.ipAddress).toBe('192.168.1.10');
    expect(d.vendor).toBe('Dell');
    expect(d.os).toBe('Windows Server 2022');
    expect(d.deviceType).toBe('server');
    expect(d.status).toBe('online');
    expect(d.lastSeenAt).toEqual(new Date(1_700_000_000 * 1000));
    expect(d.metadata?.serialNumber).toBe('SN123');
  });

  it('normalizes offline/unknown status', () => {
    expect(provider.normalize({ id: 1, offline: true }).status).toBe('offline');
    expect(provider.normalize({ id: 2, offline: false }).status).toBe('online');
    expect(provider.normalize({ id: 3 }).status).toBe('unknown');
  });

  it('collapses node classes to server/workstation', () => {
    expect(provider.normalize({ id: 1, nodeClass: 'WINDOWS_WORKSTATION' }).deviceType).toBe('workstation');
    expect(provider.normalize({ id: 2, nodeClass: 'MAC' }).deviceType).toBe('workstation');
    expect(provider.normalize({ id: 3, nodeClass: 'LINUX_SERVER' }).deviceType).toBe('server');
  });

  it('prefers systemName then dnsName then displayName', () => {
    expect(provider.normalize({ id: 1, dnsName: 'dns.local', displayName: 'Disp' }).hostname).toBe('dns.local');
    expect(provider.normalize({ id: 2, displayName: 'Disp' }).hostname).toBe('Disp');
  });

  it('throws when the device has no id', () => {
    expect(() => provider.normalize({ systemName: 'ghost' })).toThrow();
  });
});
