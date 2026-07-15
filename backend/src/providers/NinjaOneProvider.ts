/**
 * NinjaOneProvider — DeviceProvider for NinjaOne (NinjaRMM).
 *
 * Pulls devices from a NinjaOne instance and normalizes them into our local
 * Device model. The NinjaOne device id becomes the device's externalId, which
 * the NinjaOneRunner later uses to target script runs. Organization ids are
 * resolved to names so devices land under the right company.
 *
 * GoF pattern: Strategy (implements DeviceProvider)
 */

import { DeviceProvider, ExternalDevice, normalizeDeviceBatch } from './DeviceProvider';
import * as ninja from '../services/ninjaService';

export class NinjaOneProvider implements DeviceProvider {
  readonly name = 'ninjaone';
  normalizationErrors: string[] = [];

  /** organizationId → name, populated per fetch so normalize() can attach it. */
  private orgNames = new Map<number, string>();

  async fetchDevices(_since?: Date): Promise<ExternalDevice[]> {
    try {
      const orgs = await ninja.listOrganizations();
      this.orgNames = new Map(orgs.map((o) => [o.id, o.name ?? '']));
    } catch {
      // Company mapping is best-effort — a device still syncs without it.
      this.orgNames = new Map();
    }

    const devices = await ninja.listDevices();
    const batch = normalizeDeviceBatch(
      devices,
      'NinjaOne',
      (device) => this.normalize(device as unknown as Record<string, unknown>),
    );
    this.normalizationErrors = batch.errors;
    return batch.devices;
  }

  async getDevice(externalDeviceId: string): Promise<ExternalDevice | null> {
    const device = await ninja.getDevice(externalDeviceId);
    return device ? this.normalize(device as unknown as Record<string, unknown>) : null;
  }

  normalize(raw: Record<string, unknown>): ExternalDevice {
    const d = raw as ninja.NinjaDevice;
    const externalId = String(d.id ?? '').trim();
    if (!externalId) throw new Error('NinjaOne device has no id');

    const name = d.systemName || d.dnsName || d.displayName || undefined;
    const company = d.organizationId != null ? this.orgNames.get(d.organizationId) : undefined;

    return {
      externalId,
      hostname: name,
      displayName: name,
      ipAddress: Array.isArray(d.ipAddresses) ? d.ipAddresses[0] : undefined,
      vendor: d.system?.manufacturer,
      manufacturer: d.system?.manufacturer,
      model: d.system?.model,
      serialNumber: d.system?.serialNumber,
      os: d.os?.name,
      deviceType: mapNodeClass(d.nodeClass),
      status: d.offline === true ? 'offline' : d.offline === false ? 'online' : 'unknown',
      companyName: company || undefined,
      lastSeenAt: typeof d.lastContact === 'number' && Number.isFinite(d.lastContact)
        ? new Date(d.lastContact * 1000)
        : undefined,
      metadata: {
        nodeClass: d.nodeClass,
        organizationId: d.organizationId,
        publicIp: d.publicIP,
        model: d.system?.model,
        serialNumber: d.system?.serialNumber,
        osArchitecture: d.os?.architecture,
      },
    };
  }
}

/** Collapse NinjaOne's granular nodeClass into our coarse device type. */
function mapNodeClass(nodeClass?: string): string | undefined {
  if (!nodeClass) return undefined;
  const nc = nodeClass.toUpperCase();
  if (nc.includes('SERVER')) return 'server';
  if (nc.includes('WORKSTATION') || nc === 'MAC' || nc.includes('LINUX')) return 'workstation';
  return nodeClass.toLowerCase();
}
