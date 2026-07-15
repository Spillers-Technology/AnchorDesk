import { Prisma } from '@prisma/client';
import { isPlainRecord } from '../util/objects';

export class DevicePayloadValidationError extends Error {}

const DEVICE_SOURCES = new Set([
  'local',
  'netviz',
  'tactical_rmm',
  'ninjaone',
  'datto_rmm',
  'meshcentral',
  'api',
]);

const EXTERNAL_PROVIDERS = new Set([
  'netviz',
  'tactical_rmm',
  'ninjaone',
  'datto_rmm',
  'meshcentral',
]);

const PROVIDER_ALIASES: Record<string, string> = {
  tactical: 'tactical_rmm',
  trmm: 'tactical_rmm',
  ninja: 'ninjaone',
  ninja_one: 'ninjaone',
  datto: 'datto_rmm',
};

const STRING_LIMITS: Record<string, number> = {
  hostname: 255,
  displayName: 255,
  ipAddress: 45,
  macAddress: 17,
  vendor: 150,
  assetTag: 100,
  serialNumber: 150,
  manufacturer: 150,
  model: 150,
  location: 255,
  notes: 100_000,
  os: 150,
  deviceType: 100,
  status: 50,
  companyName: 150,
};

const DEVICE_FIELDS = new Set([
  ...Object.keys(STRING_LIMITS),
  'purchaseDate',
  'warrantyExpiresAt',
  'companyId',
  'source',
  'probeId',
  'externalId',
  'externalProvider',
  'openPorts',
  'metadata',
  'firstSeenAt',
  'lastSeenAt',
]);

const EXTERNAL_REF_FIELDS = new Set(['provider', 'externalId', 'metadata', 'lastSeenAt']);
const LEGACY_IDENTITY_FIELDS = ['source', 'externalId', 'externalProvider'] as const;

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function canonicalToken(value: string): string {
  const token = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return PROVIDER_ALIASES[token] ?? token;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new DevicePayloadValidationError(`${label} must be an object`);
  return value;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new DevicePayloadValidationError(`Unsupported ${label} field: ${unknown}`);
}

function nullableString(value: unknown, field: string, maxLength: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new DevicePayloadValidationError(`${field} must be a string or null`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new DevicePayloadValidationError(`${field} must be ${maxLength} characters or fewer`);
  }
  return normalized;
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  const normalized = nullableString(value, field, maxLength);
  if (normalized === null) throw new DevicePayloadValidationError(`${field} must be a non-empty string`);
  return normalized;
}

function nullablePositiveInteger(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new DevicePayloadValidationError(`${field} must be a positive integer or null`);
  }
  return Number(value);
}

function dateOnly(value: unknown, field: string): Date | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DevicePayloadValidationError(`${field} must be YYYY-MM-DD or null`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DevicePayloadValidationError(`${field} must be a real calendar date`);
  }
  return parsed;
}

function timestamp(value: unknown, field: string): Date | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new DevicePayloadValidationError(`${field} must be an ISO timestamp or null`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DevicePayloadValidationError(`${field} must be a valid ISO timestamp or null`);
  }
  return parsed;
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every((entry) => isJsonValue(entry, depth + 1));
}

function jsonObjectOrDbNull(value: unknown, field: string): Record<string, unknown> | typeof Prisma.DbNull {
  if (value === null) return Prisma.DbNull;
  if (!isPlainRecord(value) || !isJsonValue(value)) {
    throw new DevicePayloadValidationError(`${field} must be a JSON object or null`);
  }
  return value;
}

function openPortsOrDbNull(value: unknown): unknown[] | typeof Prisma.DbNull {
  if (value === null) return Prisma.DbNull;
  if (!Array.isArray(value) || !isJsonValue(value)) {
    throw new DevicePayloadValidationError('openPorts must be a JSON array or null');
  }
  for (const entry of value) {
    const port = typeof entry === 'number'
      ? entry
      : isPlainRecord(entry)
        ? entry.port
        : undefined;
    if (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65_535) {
      throw new DevicePayloadValidationError('openPorts entries must be port numbers or objects with a port from 1 to 65535');
    }
  }
  return value;
}

export function normalizeExternalProvider(value: unknown): string {
  const raw = requiredString(value, 'provider', 50);
  const provider = canonicalToken(raw);
  if (!EXTERNAL_PROVIDERS.has(provider)) {
    throw new DevicePayloadValidationError(
      `provider must be one of: ${Array.from(EXTERNAL_PROVIDERS).join(', ')}`,
    );
  }
  return provider;
}

export function normalizeRmmProvider(value: unknown): string {
  const provider = normalizeExternalProvider(value);
  if (!['tactical_rmm', 'ninjaone', 'datto_rmm'].includes(provider)) {
    throw new DevicePayloadValidationError('provider must be one of: tactical_rmm, ninjaone, datto_rmm');
  }
  return provider;
}

function normalizeDeviceSource(value: unknown): string {
  const source = canonicalToken(requiredString(value, 'source', 50));
  if (!DEVICE_SOURCES.has(source)) {
    throw new DevicePayloadValidationError(`source must be one of: ${Array.from(DEVICE_SOURCES).join(', ')}`);
  }
  return source;
}

export function hasLegacyIdentityMutation(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  return LEGACY_IDENTITY_FIELDS.some((field) => hasOwn(value, field));
}

export function validateDevicePayload(
  value: unknown,
  mode: 'create' | 'patch',
): Record<string, unknown> {
  const body = requireObject(value, 'request body');
  rejectUnknownKeys(body, DEVICE_FIELDS, 'device');
  const out: Record<string, unknown> = {};

  for (const [field, maxLength] of Object.entries(STRING_LIMITS)) {
    if (!hasOwn(body, field)) continue;
    if (field === 'status') {
      out[field] = requiredString(body[field], field, maxLength);
    } else {
      out[field] = nullableString(body[field], field, maxLength);
    }
  }

  for (const field of ['companyId', 'probeId'] as const) {
    if (hasOwn(body, field)) out[field] = nullablePositiveInteger(body[field], field);
  }
  for (const field of ['purchaseDate', 'warrantyExpiresAt'] as const) {
    if (hasOwn(body, field)) out[field] = dateOnly(body[field], field);
  }
  for (const field of ['firstSeenAt', 'lastSeenAt'] as const) {
    if (hasOwn(body, field)) out[field] = timestamp(body[field], field);
  }
  if (hasOwn(body, 'openPorts')) out.openPorts = openPortsOrDbNull(body.openPorts);
  if (hasOwn(body, 'metadata')) out.metadata = jsonObjectOrDbNull(body.metadata, 'metadata');

  const hasExternalId = hasOwn(body, 'externalId');
  const hasExternalProvider = hasOwn(body, 'externalProvider');
  if (hasExternalId !== hasExternalProvider) {
    throw new DevicePayloadValidationError('externalId and externalProvider must be supplied together');
  }

  if (hasExternalId && hasExternalProvider) {
    const externalId = nullableString(body.externalId, 'externalId', 255);
    const externalProvider = body.externalProvider === null
      ? null
      : normalizeExternalProvider(body.externalProvider);
    if ((externalId === null) !== (externalProvider === null)) {
      throw new DevicePayloadValidationError('externalId and externalProvider must both be values or both be null');
    }
    out.externalId = externalId;
    out.externalProvider = externalProvider;

    const requestedSource = hasOwn(body, 'source') ? normalizeDeviceSource(body.source) : undefined;
    const expectedSource = externalProvider ?? 'local';
    if (requestedSource !== undefined && requestedSource !== expectedSource) {
      throw new DevicePayloadValidationError(`source must be "${expectedSource}" for this external identity`);
    }
    out.source = expectedSource;
  } else if (hasOwn(body, 'source')) {
    const source = normalizeDeviceSource(body.source);
    if (mode === 'patch' && source !== 'local' && source !== 'api') {
      throw new DevicePayloadValidationError('externalId and externalProvider are required when changing to an external source');
    }
    if (mode === 'create' && source !== 'local' && source !== 'api') {
      throw new DevicePayloadValidationError('externalId and externalProvider are required for an external source');
    }
    out.source = source;
  }

  return out;
}

export function validateExternalRefPayload(value: unknown): Record<string, unknown> {
  const body = requireObject(value, 'request body');
  rejectUnknownKeys(body, EXTERNAL_REF_FIELDS, 'external reference');
  const out: Record<string, unknown> = {
    provider: normalizeExternalProvider(body.provider),
    externalId: requiredString(body.externalId, 'externalId', 255),
  };
  if (hasOwn(body, 'metadata')) out.metadata = jsonObjectOrDbNull(body.metadata, 'metadata');
  if (hasOwn(body, 'lastSeenAt')) out.lastSeenAt = timestamp(body.lastSeenAt, 'lastSeenAt');
  return out;
}
