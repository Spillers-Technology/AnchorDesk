/**
 * deviceSyncService — pulls devices from a DeviceProvider into the local table.
 *
 * netviz is push-based (probes POST to us), but RMMs like Tactical are pull-based,
 * so this runs a fetch + upsert cycle on demand (admin "Sync from Tactical").
 */

import { DeviceProvider } from '../providers/DeviceProvider';
import * as deviceRepo from '../repositories/deviceRepository';
import { DeviceSource } from '@prisma/client';
import { getAdapter } from '../rmm/registry';

export interface DeviceSyncResult {
  provider: string;
  created: number;
  updated: number;
  errors: string[];
  durationMs: number;
}

async function syncProvider(
  provider: DeviceProvider,
  source: DeviceSource,
  actorSub: string
): Promise<DeviceSyncResult> {
  const start = Date.now();
  const result: DeviceSyncResult = { provider: provider.name, created: 0, updated: 0, errors: [], durationMs: 0 };

  if (!provider.fetchDevices) {
    result.errors.push(`${provider.name} does not support pull sync`);
    result.durationMs = Date.now() - start;
    return result;
  }

  let devices;
  try {
    devices = await provider.fetchDevices();
  } catch (err) {
    result.errors.push((err as Error).message);
    result.durationMs = Date.now() - start;
    return result;
  }

  for (const ext of devices) {
    try {
      const { created } = await deviceRepo.upsertExternal(
        ext.externalId,
        provider.name,
        {
          hostname: ext.hostname,
          displayName: ext.displayName,
          ipAddress: ext.ipAddress,
          macAddress: ext.macAddress,
          vendor: ext.vendor,
          os: ext.os,
          deviceType: ext.deviceType,
          openPorts: ext.openPorts,
          status: ext.status,
          companyName: ext.companyName,
          source,
          lastSeenAt: ext.lastSeenAt ?? new Date(),
          metadata: ext.metadata,
        },
        actorSub
      );
      created ? result.created++ : result.updated++;
    } catch (err) {
      result.errors.push(`${ext.externalId}: ${(err as Error).message}`);
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}

/**
 * Pull devices from any registered RMM by its device-source key
 * ('tactical_rmm' | 'ninjaone' | 'datto_rmm'). The registry owns the provider +
 * config check; this just runs the shared fetch + upsert cycle.
 */
export function syncBySource(source: string, actorSub: string): Promise<DeviceSyncResult> {
  const adapter = getAdapter(source);
  if (!adapter) {
    return Promise.resolve({
      provider: source,
      created: 0,
      updated: 0,
      errors: [`Unknown RMM source "${source}"`],
      durationMs: 0,
    });
  }
  if (!adapter.isConfigured()) {
    return Promise.resolve({
      provider: adapter.key,
      created: 0,
      updated: 0,
      errors: [`${adapter.label} is not configured`],
      durationMs: 0,
    });
  }
  return syncProvider(adapter.provider(), adapter.key as DeviceSource, actorSub);
}

/** Back-compat helper — the original Tactical-only entrypoint. */
export function syncTactical(actorSub: string): Promise<DeviceSyncResult> {
  return syncBySource('tactical_rmm', actorSub);
}
