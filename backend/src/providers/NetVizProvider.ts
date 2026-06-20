/**
 * NetVizProvider — reference DeviceProvider for the netviz LAN scanner.
 *
 * netviz (https://spillers-technology.github.io/netviz/) is a Go+Wails scanner
 * that emits device records over its event bus and exports versioned NetViz JSON.
 * A netviz instance deployed on a customer LAN acts as a *probe*: it POSTs its
 * scan results to AnchorDesk's ingest endpoint, and we normalize each record
 * into our local Device model here.
 *
 * THIS FILE OWNS THE WIRE CONTRACT. The shape below (NetVizDeviceRecord) is the
 * agreement between the two projects — keep it in sync with the netviz exporter.
 * That shared contract is the "meet in the middle" point; see netviz-claude-todo.md.
 *
 * GoF pattern: Strategy (implements DeviceProvider)
 */

import { DeviceProvider, ExternalDevice } from './DeviceProvider';

/** netviz JSON device record (contract v1). Field aliases are tolerated so a
 *  minor netviz schema drift doesn't break ingest. */
export interface NetVizDeviceRecord {
  /** Stable per-device id from netviz; falls back to mac, then ip. */
  id?: string;
  ip?: string;
  ipAddress?: string;
  hostname?: string;
  name?: string;
  mac?: string;
  macAddress?: string;
  vendor?: string;
  manufacturer?: string;
  os?: string;
  /** netviz device classification, e.g. "printer", "router", "workstation". */
  deviceType?: string;
  classification?: string;
  /** Open TCP ports as numbers, or {port}[] objects. */
  openPorts?: Array<number | { port: number }>;
  ports?: Array<number | { port: number }>;
  /** 'up' | 'down' | 'online' | 'offline' — normalized below. */
  status?: string;
  state?: string;
  firstSeen?: string;
  lastSeen?: string;
  lastUpdated?: string;
}

export const NETVIZ_CONTRACT_VERSION = 1;

export class NetVizProvider implements DeviceProvider {
  readonly name = 'netviz';

  private readonly companyName?: string;

  /** companyName is taken from the probe so all its devices land under one company. */
  constructor(companyName?: string) {
    this.companyName = companyName;
  }

  normalize(raw: Record<string, unknown>): ExternalDevice {
    const r = raw as NetVizDeviceRecord;

    const ip = r.ip ?? r.ipAddress;
    const mac = r.mac ?? r.macAddress;
    const externalId = String(r.id ?? mac ?? ip ?? '').trim();
    if (!externalId) throw new Error('netviz record has no id/mac/ip to key on');

    return {
      externalId,
      hostname: r.hostname ?? r.name,
      displayName: r.hostname ?? r.name ?? ip,
      ipAddress: ip,
      macAddress: mac,
      vendor: r.vendor ?? r.manufacturer,
      os: r.os,
      deviceType: r.deviceType ?? r.classification,
      openPorts: normalizePorts(r.openPorts ?? r.ports),
      status: normalizeStatus(r.status ?? r.state),
      companyName: this.companyName,
      firstSeenAt: parseDate(r.firstSeen),
      lastSeenAt: parseDate(r.lastSeen ?? r.lastUpdated),
    };
  }
}

function normalizePorts(ports?: Array<number | { port: number }>): number[] | undefined {
  if (!Array.isArray(ports)) return undefined;
  return ports
    .map((p) => (typeof p === 'number' ? p : p?.port))
    .filter((p): p is number => typeof p === 'number');
}

function normalizeStatus(status?: string): string {
  if (!status) return 'unknown';
  const s = status.toLowerCase();
  if (s === 'up' || s === 'online') return 'online';
  if (s === 'down' || s === 'offline') return 'offline';
  return 'unknown';
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}
