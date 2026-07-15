/**
 * Pure helpers for coalescing observations from multiple device providers into
 * one local configuration. Provider ids stay separate; this module only decides
 * which shared Device fields are safe to refresh.
 */

export interface DeviceMergeSnapshot {
  hostname?: string | null;
  displayName?: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  vendor?: string | null;
  assetTag?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  location?: string | null;
  purchaseDate?: Date | string | null;
  warrantyExpiresAt?: Date | string | null;
  notes?: string | null;
  os?: string | null;
  deviceType?: string | null;
  openPorts?: unknown;
  status?: string | null;
  companyName?: string | null;
  companyId?: number | null;
  probeId?: number | null;
  metadata?: unknown;
  firstSeenAt?: Date | null;
  lastSeenAt?: Date | null;
}

const TELEMETRY_FIELDS = [
  'hostname',
  'displayName',
  'ipAddress',
  'macAddress',
  'vendor',
  'os',
  'deviceType',
  'openPorts',
  'companyName',
  'companyId',
  'probeId',
] as const;

const ASSET_FIELDS = [
  'assetTag',
  'serialNumber',
  'manufacturer',
  'model',
  'location',
  'purchaseDate',
  'warrantyExpiresAt',
  'notes',
] as const;

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function asDate(value: Date | string | null | undefined): Date | undefined {
  if (value == null || value === '') return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export interface ObservationTimestamps {
  firstSeenAt?: Date | string | null;
  lastSeenAt?: Date | string | null;
}

/**
 * Return only timestamp changes that extend an observation window. This keeps
 * delayed provider payloads from moving firstSeenAt forward or lastSeenAt
 * backward.
 */
export function monotonicTimestampPatch(
  current: ObservationTimestamps,
  incoming: ObservationTimestamps,
): { firstSeenAt?: Date; lastSeenAt?: Date } {
  const patch: { firstSeenAt?: Date; lastSeenAt?: Date } = {};
  const incomingFirst = asDate(incoming.firstSeenAt);
  const currentFirst = asDate(current.firstSeenAt);
  if (incomingFirst && (!currentFirst || incomingFirst < currentFirst)) patch.firstSeenAt = incomingFirst;

  const incomingLast = asDate(incoming.lastSeenAt);
  const currentLast = asDate(current.lastSeenAt);
  if (incomingLast && (!currentLast || incomingLast > currentLast)) patch.lastSeenAt = incomingLast;
  return patch;
}

/** Normalize provider-supplied company labels for identity comparisons. */
export function normalizeCompanyName(value?: string | null): string | undefined {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  return normalized || undefined;
}

/**
 * Company ids are preferred, but a normalized name is an intentional fallback
 * for providers that have not yet resolved their company foreign key.
 */
export function sameCompanyIdentity(
  current: Pick<DeviceMergeSnapshot, 'companyId' | 'companyName'>,
  incoming: Pick<DeviceMergeSnapshot, 'companyId' | 'companyName'>,
): boolean {
  if (incoming.companyId != null && current.companyId != null) {
    return current.companyId === incoming.companyId;
  }
  const incomingName = normalizeCompanyName(incoming.companyName);
  return !!incomingName && normalizeCompanyName(current.companyName) === incomingName;
}

/** MAC variants accepted by older probes/RMMs, all representing one address. */
export function macIdentityVariants(value?: string | null): string[] {
  if (!value) return [];
  const hex = value.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (hex === '000000000000' || hex === 'ffffffffffff') return [];
  if (hex.length !== 12) return [];
  const pairs = hex.match(/.{2}/g) ?? [];
  return [pairs.join(':'), pairs.join('-'), hex];
}

const SERIAL_PLACEHOLDERS = new Set([
  'default string',
  'n/a',
  'na',
  'none',
  'not applicable',
  'not specified',
  'null',
  'system serial number',
  'to be filled by o.e.m.',
  'unknown',
]);

/** Return a serial suitable for identity matching, excluding common DMI placeholders. */
export function serialIdentityValue(value?: string | null): string | undefined {
  const serial = value?.normalize('NFKC').trim();
  if (!serial) return undefined;
  const normalized = serial.replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  const compact = normalized.replace(/[^0-9a-z]/g, '');
  if (SERIAL_PLACEHOLDERS.has(normalized) || /^0+$/.test(compact) || /^f+$/.test(compact)) {
    return undefined;
  }
  return serial;
}

/**
 * The legacy primary provider may refresh operational fields. Every secondary
 * provider remains fill-only on every sync so a repeat observation cannot take
 * authority merely because its ref already exists. Asset fields are always
 * fill-only because operators own them locally.
 */
export function mergeExternalObservation<T extends DeviceMergeSnapshot>(
  current: T,
  incoming: DeviceMergeSnapshot,
  primaryProvider: boolean,
): DeviceMergeSnapshot {
  const patch: DeviceMergeSnapshot = {};

  for (const field of TELEMETRY_FIELDS) {
    const value = incoming[field];
    if (!present(value)) continue;
    if (primaryProvider || !present(current[field])) (patch as Record<string, unknown>)[field] = value;
  }

  for (const field of ASSET_FIELDS) {
    const value = incoming[field];
    if (present(value) && !present(current[field])) (patch as Record<string, unknown>)[field] = value;
  }

  if (incoming.status) {
    const currentStatus = current.status ?? 'unknown';
    if (primaryProvider || currentStatus === 'unknown') patch.status = incoming.status;
  }

  const timestamps = monotonicTimestampPatch(current, incoming);
  if (timestamps.firstSeenAt && (primaryProvider || !asDate(current.firstSeenAt))) {
    patch.firstSeenAt = timestamps.firstSeenAt;
  }
  if (timestamps.lastSeenAt && (primaryProvider || !asDate(current.lastSeenAt))) {
    patch.lastSeenAt = timestamps.lastSeenAt;
  }

  return patch;
}
