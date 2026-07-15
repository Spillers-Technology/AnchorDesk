/**
 * DeviceProvider — Strategy interface for external device sources.
 *
 * Mirror of TicketProvider, but for the device/asset side. Implement this to add
 * a new RMM or scanner adapter (netviz, Tactical RMM, MeshCentral, ...). The
 * device sync service calls these methods and has no knowledge of the concrete
 * platform. See NetVizProvider.ts for the reference implementation.
 *
 * GoF pattern: Strategy
 */

export interface ExternalDevice {
  externalId: string;
  hostname?: string;
  displayName?: string;
  ipAddress?: string;
  macAddress?: string;
  vendor?: string;
  assetTag?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  location?: string;
  purchaseDate?: Date;
  warrantyExpiresAt?: Date;
  notes?: string;
  os?: string;
  deviceType?: string;
  /** Open TCP ports discovered, if any. */
  openPorts?: number[];
  /** Normalized liveness: 'online' | 'offline' | 'unknown'. */
  status?: string;
  companyName?: string;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  /** Anything provider-specific worth keeping but not first-class. */
  metadata?: Record<string, unknown>;
}

export interface TicketProviderLike {
  readonly name: string;
}

export interface DeviceProvider {
  /** Provider key stored in devices.external_provider (e.g. 'netviz'). */
  readonly name: string;

  /** Per-record normalization failures from the most recent fetch. A malformed
   *  inventory row must not prevent valid siblings from syncing. */
  readonly normalizationErrors?: string[];

  /** Fetch devices changed since `since`, or all devices if omitted.
   *  Push-based providers (a probe POSTing inbound) may leave this unimplemented. */
  fetchDevices?(since?: Date): Promise<ExternalDevice[]>;

  /** Fetch a single device by its external ID. */
  getDevice?(externalDeviceId: string): Promise<ExternalDevice | null>;

  /** Normalize one raw provider payload into an ExternalDevice.
   *  Used by inbound ingest endpoints (the probe sends raw, we normalize here)
   *  so the wire contract stays owned by the provider, not the route. */
  normalize(raw: Record<string, unknown>): ExternalDevice;
}

/** Normalize a provider inventory without allowing one malformed row to abort
 * the entire pull. The caller exposes `errors` through normalizationErrors. */
export function normalizeDeviceBatch<T>(
  records: T[],
  providerLabel: string,
  normalize: (record: T) => ExternalDevice,
): { devices: ExternalDevice[]; errors: string[] } {
  const devices: ExternalDevice[] = [];
  const errors: string[] = [];
  records.forEach((record, index) => {
    try {
      devices.push(normalize(record));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${providerLabel} record ${index + 1}: ${message}`);
    }
  });
  return { devices, errors };
}
