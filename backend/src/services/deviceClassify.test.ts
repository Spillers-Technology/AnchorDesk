import { classifyDevice, classifyHost, serviceName } from './deviceClassify';
import { normalizeMac, vendorForMac } from './oui';

describe('device intelligence', () => {
  it('classifies services and port fingerprints', () => {
    expect(serviceName(443)).toBe('https');
    expect(serviceName(12345)).toBe('tcp/12345');
    expect(classifyDevice([631, 9100])).toBe('printer');
    expect(classifyDevice([22, 443])).toBe('ssh_device');
  });

  it('falls back to vendor and hostname signals', () => {
    expect(classifyHost({ vendor: 'Ubiquiti Networks', openPorts: [] })).toBe('network_device');
    expect(classifyHost({ hostname: 'front-printer', openPorts: [] })).toBe('printer');
  });

  it('normalizes MACs and prefers friendly curated vendors', () => {
    expect(normalizeMac('b8-27-eb-1-2-3')).toBe('b8:27:eb:01:02:03');
    expect(vendorForMac('b8:27:eb:01:02:03')).toBe('Raspberry Pi');
  });
});
