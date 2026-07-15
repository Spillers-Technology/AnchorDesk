/**
 * TacticalRmmProvider — DeviceProvider for Tactical RMM.
 *
 * Pulls agents from a Tactical instance and normalizes them into our local
 * Device model. The agent_id becomes the device's externalId, which the
 * TacticalRmmRunner later uses to target script runs.
 *
 * GoF pattern: Strategy (implements DeviceProvider)
 */

import { DeviceProvider, ExternalDevice, normalizeDeviceBatch } from './DeviceProvider';
import * as tactical from '../services/tacticalService';

export class TacticalRmmProvider implements DeviceProvider {
  readonly name = 'tactical_rmm';
  normalizationErrors: string[] = [];

  async fetchDevices(_since?: Date): Promise<ExternalDevice[]> {
    const agents = await tactical.listAgents();
    const batch = normalizeDeviceBatch(
      agents,
      'Tactical RMM',
      (agent) => this.normalize(agent as unknown as Record<string, unknown>),
    );
    this.normalizationErrors = batch.errors;
    return batch.devices;
  }

  async getDevice(externalDeviceId: string): Promise<ExternalDevice | null> {
    const agent = await tactical.getAgent(externalDeviceId);
    return agent ? this.normalize(agent as unknown as Record<string, unknown>) : null;
  }

  normalize(raw: Record<string, unknown>): ExternalDevice {
    const a = raw as tactical.TacticalAgent;
    const externalId = String(a.agent_id ?? '').trim();
    if (!externalId) throw new Error('Tactical agent has no agent_id');

    const firstIp = a.local_ips ? String(a.local_ips).split(/[,\s]+/).filter(Boolean)[0] : undefined;

    return {
      externalId,
      hostname: a.hostname,
      displayName: a.hostname,
      ipAddress: firstIp,
      vendor: a.make_model,
      model: a.make_model,
      serialNumber: a.serial_number,
      os: a.operating_system,
      deviceType: a.monitoring_type, // 'server' | 'workstation'
      status: normalizeStatus(a.status),
      companyName: a.client_name,
      lastSeenAt: validDate(a.last_seen),
      metadata: {
        plat: a.plat,
        siteName: a.site_name,
        publicIp: a.public_ip,
        serialNumber: a.serial_number,
        cpuModel: a.cpu_model,
      },
    };
  }
}

function validDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeStatus(status?: string): string {
  if (!status) return 'unknown';
  const s = status.toLowerCase();
  if (s === 'online') return 'online';
  if (s === 'offline' || s === 'overdue') return 'offline';
  return 'unknown';
}
