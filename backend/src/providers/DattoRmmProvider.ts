/**
 * DattoRmmProvider — DeviceProvider for Datto RMM.
 *
 * Pulls devices from the account/devices endpoint and normalizes them into our
 * local Device model. The device uid becomes the externalId, which the
 * DattoRmmRunner later uses to queue quick jobs.
 *
 * GoF pattern: Strategy (implements DeviceProvider)
 */

import { DeviceProvider, ExternalDevice, normalizeDeviceBatch } from './DeviceProvider';
import * as datto from '../services/dattoService';

export class DattoRmmProvider implements DeviceProvider {
  readonly name = 'datto_rmm';
  normalizationErrors: string[] = [];

  async fetchDevices(_since?: Date): Promise<ExternalDevice[]> {
    const devices = await datto.listDevices();
    const batch = normalizeDeviceBatch(
      devices,
      'Datto RMM',
      (device) => this.normalize(device as unknown as Record<string, unknown>),
    );
    this.normalizationErrors = batch.errors;
    return batch.devices;
  }

  async getDevice(externalDeviceId: string): Promise<ExternalDevice | null> {
    const device = await datto.getDevice(externalDeviceId);
    return device ? this.normalize(device as unknown as Record<string, unknown>) : null;
  }

  normalize(raw: Record<string, unknown>): ExternalDevice {
    const d = raw as datto.DattoDevice;
    const externalId = String(d.uid ?? '').trim();
    if (!externalId) throw new Error('Datto RMM device has no uid');

    const name = d.hostname || d.systemName || d.description || undefined;

    return {
      externalId,
      hostname: name,
      displayName: d.description || name,
      ipAddress: d.intIpAddress,
      vendor: d.manufacturer,
      manufacturer: d.manufacturer,
      model: d.model,
      serialNumber: d.serialNumber,
      os: d.operatingSystem,
      deviceType: mapCategory(d.deviceType?.category),
      status: d.online === true ? 'online' : d.online === false ? 'offline' : 'unknown',
      companyName: d.siteName || undefined,
      lastSeenAt: parseLastSeen(d.lastSeen),
      metadata: {
        category: d.deviceType?.category,
        type: d.deviceType?.type,
        extIpAddress: d.extIpAddress,
        siteName: d.siteName,
      },
    };
  }
}

function mapCategory(category?: string): string | undefined {
  if (!category) return undefined;
  const c = category.toLowerCase();
  if (c.includes('server')) return 'server';
  if (c.includes('desktop') || c.includes('laptop') || c.includes('workstation')) return 'workstation';
  return c;
}

/** Datto lastSeen may be epoch millis or an ISO string. */
function parseLastSeen(value?: number | string): Date | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  const asNum = Number(value);
  const parsed = Number.isFinite(asNum) ? new Date(asNum) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
