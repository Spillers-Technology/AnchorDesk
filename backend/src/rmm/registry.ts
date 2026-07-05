/**
 * RMM registry — the single place that knows the set of supported RMMs and how
 * to talk to each. Routes (status, script catalogue, sync, live glance) look an
 * RMM up here by its device-source key instead of hard-coding one platform.
 *
 * Each adapter wires together the pieces already implemented as Strategies:
 *   - config check  (services/*Service.isConfigured)
 *   - device sync   (providers/*Provider — DeviceProvider)
 *   - script runs   (runners/* — resolved via createScriptRunner by the same key)
 *   - script catalogue + live glance (below)
 *
 * GoF pattern: Registry over the Strategy families (providers + runners).
 */

import { DeviceSource } from '@prisma/client';
import { DeviceProvider } from '../providers/DeviceProvider';
import { TacticalRmmProvider } from '../providers/TacticalRmmProvider';
import { NinjaOneProvider } from '../providers/NinjaOneProvider';
import { DattoRmmProvider } from '../providers/DattoRmmProvider';
import * as tactical from '../services/tacticalService';
import * as ninja from '../services/ninjaService';
import * as datto from '../services/dattoService';

/** A runnable script as the picker needs it. `id` is the runner's script ref. */
export interface RmmScript {
  id: string;
  name: string;
  shell?: string;
}

export interface RmmAdapter {
  /** Matches DeviceSource / the runner key (e.g. 'tactical_rmm'). */
  readonly key: Extract<DeviceSource, 'tactical_rmm' | 'ninjaone' | 'datto_rmm'>;
  readonly label: string;
  /** Whether the RMM catalogues its scripts over the API. Datto does not — the
   *  UI lets the tech paste a component UID instead of picking from a list. */
  readonly hasScriptCatalog: boolean;
  isConfigured(): boolean;
  provider(): DeviceProvider;
  listScripts(): Promise<RmmScript[]>;
  /** A fresh, on-open operational snapshot straight from the RMM. */
  live(externalId: string): Promise<Record<string, unknown>>;
}

const tacticalAdapter: RmmAdapter = {
  key: 'tactical_rmm',
  label: 'Tactical RMM',
  hasScriptCatalog: true,
  isConfigured: () => tactical.isConfigured(),
  provider: () => new TacticalRmmProvider(),
  async listScripts() {
    const scripts = await tactical.listScripts();
    return scripts.map((s) => ({ id: String(s.id), name: s.name, shell: s.shell }));
  },
  async live(externalId) {
    const a = await tactical.getAgent(externalId);
    return {
      provider: 'tactical_rmm',
      fetchedAt: new Date().toISOString(),
      externalId: a.agent_id,
      hostname: a.hostname ?? null,
      status: a.status ?? 'unknown',
      operatingSystem: a.operating_system ?? null,
      platform: a.plat ?? null,
      localIps: String(a.local_ips ?? '').split(/[,\s]+/).filter(Boolean),
      publicIp: a.public_ip ?? null,
      clientName: a.client_name ?? null,
      siteName: a.site_name ?? null,
      monitoringType: a.monitoring_type ?? null,
      lastSeen: a.last_seen ?? null,
      makeModel: a.make_model ?? null,
      serialNumber: a.serial_number ?? null,
      cpuModel: Array.isArray(a.cpu_model) ? a.cpu_model.join(', ') : a.cpu_model ?? null,
    };
  },
};

const ninjaAdapter: RmmAdapter = {
  key: 'ninjaone',
  label: 'NinjaOne',
  hasScriptCatalog: true,
  isConfigured: () => ninja.isConfigured(),
  provider: () => new NinjaOneProvider(),
  async listScripts() {
    const scripts = await ninja.listScripts();
    return scripts.map((s) => ({ id: String(s.id), name: s.name, shell: s.language }));
  },
  async live(externalId) {
    const d = await ninja.getDevice(externalId);
    return {
      provider: 'ninjaone',
      fetchedAt: new Date().toISOString(),
      externalId: String(d.id),
      hostname: d.systemName ?? d.dnsName ?? d.displayName ?? null,
      status: d.offline === true ? 'offline' : d.offline === false ? 'online' : 'unknown',
      operatingSystem: d.os?.name ?? null,
      platform: d.nodeClass ?? null,
      localIps: Array.isArray(d.ipAddresses) ? d.ipAddresses : [],
      publicIp: d.publicIP ?? null,
      siteName: null,
      lastSeen: d.lastContact ? new Date(d.lastContact * 1000).toISOString() : null,
      makeModel: [d.system?.manufacturer, d.system?.model].filter(Boolean).join(' ') || null,
      serialNumber: d.system?.serialNumber ?? null,
    };
  },
};

const dattoAdapter: RmmAdapter = {
  key: 'datto_rmm',
  label: 'Datto RMM',
  // Datto exposes no component catalogue over the API — the tech pastes a UID.
  hasScriptCatalog: false,
  isConfigured: () => datto.isConfigured(),
  provider: () => new DattoRmmProvider(),
  async listScripts() {
    return [];
  },
  async live(externalId) {
    const d = await datto.getDevice(externalId);
    return {
      provider: 'datto_rmm',
      fetchedAt: new Date().toISOString(),
      externalId: d.uid,
      hostname: d.hostname ?? d.systemName ?? null,
      status: d.online === true ? 'online' : d.online === false ? 'offline' : 'unknown',
      operatingSystem: d.operatingSystem ?? null,
      platform: d.deviceType?.category ?? null,
      localIps: d.intIpAddress ? [d.intIpAddress] : [],
      publicIp: d.extIpAddress ?? null,
      siteName: d.siteName ?? null,
      lastSeen: d.lastSeen != null ? String(d.lastSeen) : null,
    };
  },
};

const ADAPTERS: Record<RmmAdapter['key'], RmmAdapter> = {
  tactical_rmm: tacticalAdapter,
  ninjaone: ninjaAdapter,
  datto_rmm: dattoAdapter,
};

export function getAdapter(key: string): RmmAdapter | undefined {
  return (ADAPTERS as Record<string, RmmAdapter>)[key];
}

export function listAdapters(): RmmAdapter[] {
  return Object.values(ADAPTERS);
}

export function configuredAdapters(): RmmAdapter[] {
  return listAdapters().filter((a) => a.isConfigured());
}
