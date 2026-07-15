import { DeviceSource, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { classifyHost } from '../services/deviceClassify';
import { vendorForMac } from '../services/oui';
import {
  macIdentityVariants,
  mergeExternalObservation,
  monotonicTimestampPatch,
  normalizeCompanyName,
  sameCompanyIdentity,
  serialIdentityValue,
} from '../services/deviceMerge';

export interface DeviceListOptions {
  companyName?: string;
  source?: DeviceSource;
  status?: string;
  probeId?: number;
  page?: number;
  pageSize?: number;
}

export interface CreateDeviceInput {
  hostname?: string;
  displayName?: string;
  ipAddress?: string;
  macAddress?: string;
  vendor?: string;
  assetTag?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  location?: string | null;
  purchaseDate?: Date | string | null;
  warrantyExpiresAt?: Date | string | null;
  notes?: string | null;
  os?: string;
  deviceType?: string;
  openPorts?: unknown;
  status?: string;
  companyName?: string;
  companyId?: number | null;
  source?: DeviceSource;
  probeId?: number;
  externalId?: string;
  externalProvider?: string;
  metadata?: unknown;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
}

export type UpdateDeviceInput = Partial<CreateDeviceInput>;

export interface ExternalRefInput {
  provider: string;
  externalId: string;
  metadata?: unknown;
  firstSeenAt?: Date | string | null;
  lastSeenAt?: Date | string | null;
}

type DeviceStore = Pick<Prisma.TransactionClient, 'device' | 'deviceExternalRef'>;

const IDENTITY_TRANSACTION_RETRIES = 3;

function prismaCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return String((error as { code?: unknown }).code);
}

/** Retry serialization and uniqueness races so the next pass can read the winner. */
async function withIdentityTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const retryable = prismaCode(error) === 'P2002' || prismaCode(error) === 'P2034';
      if (!retryable || attempt >= IDENTITY_TRANSACTION_RETRIES) throw error;
    }
  }
}

const deviceInclude = Prisma.validator<Prisma.DeviceInclude>()({
  probe: { select: { id: true, name: true, status: true } },
  externalRefs: { orderBy: [{ provider: 'asc' }, { id: 'asc' }] },
});

function dateValue(value: Date | string | null | undefined): Date | null | undefined {
  if (value === null || value === undefined) return value;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${value}`);
  return parsed;
}

function jsonValue(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function toData(input: CreateDeviceInput) {
  return {
    hostname: input.hostname,
    displayName: input.displayName,
    ipAddress: input.ipAddress,
    macAddress: input.macAddress,
    vendor: input.vendor,
    assetTag: input.assetTag,
    serialNumber: input.serialNumber,
    manufacturer: input.manufacturer,
    model: input.model,
    location: input.location,
    purchaseDate: dateValue(input.purchaseDate),
    warrantyExpiresAt: dateValue(input.warrantyExpiresAt),
    notes: input.notes,
    os: input.os,
    deviceType: input.deviceType,
    openPorts: (input.openPorts as Prisma.InputJsonValue) ?? undefined,
    status: input.status,
    companyName: input.companyName,
    companyId: input.companyId,
    source: input.source,
    probeId: input.probeId,
    externalId: input.externalId,
    externalProvider: input.externalProvider,
    metadata: jsonValue(input.metadata),
    firstSeenAt: input.firstSeenAt,
    lastSeenAt: input.lastSeenAt,
  };
}

function portNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => typeof entry === 'number' ? entry : Number((entry as { port?: unknown })?.port))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
}

/** Fill missing intelligence without replacing values supplied by an RMM/user. */
function enrich(input: CreateDeviceInput, current?: { hostname: string | null; macAddress: string | null; vendor: string | null; deviceType: string | null; openPorts: unknown }): CreateDeviceInput {
  const enriched = { ...input };
  const mac = input.macAddress ?? current?.macAddress;
  const suppliedVendor = input.vendor?.trim();
  const existingVendor = current?.vendor?.trim();
  const vendor = suppliedVendor || existingVendor || (mac ? vendorForMac(mac) : '');
  const ports = portNumbers(input.openPorts ?? current?.openPorts);
  if (!suppliedVendor && !existingVendor && vendor) enriched.vendor = vendor;
  if (!input.deviceType?.trim() && !current?.deviceType?.trim()) {
    enriched.deviceType = classifyHost({ vendor, hostname: input.hostname ?? current?.hostname, openPorts: ports });
  }
  return enriched;
}

export async function list(opts: DeviceListOptions = {}) {
  const { page = 1, pageSize = 100, ...filters } = opts;
  const where: Prisma.DeviceWhereInput = {};

  if (filters.companyName) where.companyName = { contains: filters.companyName };
  if (filters.source) {
    where.OR = [
      { source: filters.source },
      { externalRefs: { some: { provider: filters.source } } },
    ];
  }
  if (filters.status) where.status = filters.status;
  if (filters.probeId) where.probeId = filters.probeId;

  return prisma.device.findMany({
    where,
    orderBy: { lastSeenAt: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: deviceInclude,
  });
}

export async function getById(id: number) {
  return prisma.device.findUnique({
    where: { id },
    include: {
      ...deviceInclude,
      ticketLinks: { include: { ticket: { select: { id: true, title: true, status: true } } } },
    },
  });
}

export async function create(input: CreateDeviceInput, actorSub: string) {
  input = enrich(input);
  const primary = normalizedPrimaryIdentity(input.externalProvider, input.externalId);
  const createData = {
    ...toData(input),
    externalProvider: primary?.provider ?? null,
    externalId: primary?.externalId ?? null,
    source: input.source ?? 'local' as DeviceSource,
  };

  const device = primary
    ? await withIdentityTransaction(async (tx) => {
      const claim = await findExternalClaim(tx, primary.provider, primary.externalId);
      if (claim.deviceId != null) throw externalClaimError(primary.provider, primary.externalId, claim.deviceId);
      const created = await tx.device.create({ data: createData });
      await upsertExternalRefTx(tx, created.id, {
        provider: primary.provider,
        externalId: primary.externalId,
        metadata: input.metadata,
        firstSeenAt: input.firstSeenAt,
        lastSeenAt: input.lastSeenAt,
      });
      return created;
    })
    : await prisma.device.create({ data: createData });

  await audit.record({
    entityType: 'device',
    entityId: device.id,
    action: 'create',
    changedBy: actorSub,
    newValue: device as unknown as Record<string, unknown>,
  });

  return getById(device.id);
}

export async function update(id: number, input: UpdateDeviceInput, actorSub: string) {
  const result = await withIdentityTransaction(async (tx) => {
    const before = await tx.device.findUnique({ where: { id } });
    if (!before) return null;
    assertPrimaryIdentityUnchanged(before, input);

    const enriched = enrich(input, before);
    const {
      externalId: _externalId,
      externalProvider: _externalProvider,
      ...safeData
    } = toData(enriched);
    const timestamps = monotonicTimestampPatch(before, input);
    if (input.firstSeenAt !== undefined) safeData.firstSeenAt = timestamps.firstSeenAt;
    if (input.lastSeenAt !== undefined) safeData.lastSeenAt = timestamps.lastSeenAt;

    const device = await tx.device.update({ where: { id }, data: safeData });
    if (before.externalProvider && before.externalId && (
      input.metadata !== undefined
      || input.firstSeenAt !== undefined
      || input.lastSeenAt !== undefined
    )) {
      await upsertExternalRefTx(tx, id, {
        provider: before.externalProvider,
        externalId: before.externalId,
        metadata: input.metadata,
        firstSeenAt: input.firstSeenAt,
        lastSeenAt: input.lastSeenAt,
      });
    }
    return { before, device };
  });
  if (!result) return null;

  await audit.record({
    entityType: 'device',
    entityId: id,
    action: 'update',
    changedBy: actorSub,
    oldValue: result.before as unknown as Record<string, unknown>,
    newValue: result.device as unknown as Record<string, unknown>,
  });

  return getById(result.device.id);
}

export async function remove(id: number, actorSub: string) {
  const before = await prisma.device.findUnique({ where: { id } });
  if (!before) return null;

  await prisma.device.delete({ where: { id } });

  await audit.record({
    entityType: 'device',
    entityId: id,
    action: 'delete',
    changedBy: actorSub,
    oldValue: before as unknown as Record<string, unknown>,
  });

  return before;
}

const DEVICE_SOURCES = new Set<DeviceSource>([
  'local', 'netviz', 'tactical_rmm', 'ninjaone', 'datto_rmm', 'meshcentral', 'api',
]);

interface PrimaryIdentity {
  provider: string;
  externalId: string;
}

function normalizedPrimaryIdentity(
  providerValue: string | null | undefined,
  externalIdValue: string | null | undefined,
): PrimaryIdentity | null {
  const provider = providerValue?.trim() ?? '';
  const externalId = externalIdValue?.trim() ?? '';
  if (!!provider !== !!externalId) throw new Error('external id and provider must be set or cleared together');
  return provider ? { provider, externalId } : null;
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function assertPrimaryIdentityUnchanged(
  current: { externalProvider: string | null; externalId: string | null },
  input: UpdateDeviceInput,
) {
  if (!hasOwn(input, 'externalProvider') && !hasOwn(input, 'externalId')) return;
  const desired = normalizedPrimaryIdentity(
    hasOwn(input, 'externalProvider') ? input.externalProvider : current.externalProvider,
    hasOwn(input, 'externalId') ? input.externalId : current.externalId,
  );
  const existing = normalizedPrimaryIdentity(current.externalProvider, current.externalId);
  if (desired?.provider !== existing?.provider || desired?.externalId !== existing?.externalId) {
    throw new Error('Primary external identity cannot be changed through device update; use external-reference endpoints');
  }
}

function sourceForProvider(provider: string, fallback: DeviceSource = 'api'): DeviceSource {
  return DEVICE_SOURCES.has(provider as DeviceSource) ? provider as DeviceSource : fallback;
}

async function companyScopedCandidate<T extends { companyId: number | null; companyName: string | null }>(
  candidates: T[],
  input: CreateDeviceInput,
): Promise<T | null> {
  if (input.companyId != null) {
    const idMatch = candidates.find((candidate) => candidate.companyId === input.companyId);
    if (idMatch) return idMatch;
  }
  const companyName = normalizeCompanyName(input.companyName);
  if (!companyName) return null;
  return candidates.find((candidate) => sameCompanyIdentity(candidate, input)) ?? null;
}

async function findByPhysicalIdentity(db: DeviceStore, input: CreateDeviceInput) {
  const macVariants = macIdentityVariants(input.macAddress);
  if (macVariants.length) {
    return db.device.findFirst({
      where: {
        OR: macVariants.map((macAddress) => ({ macAddress: { equals: macAddress, mode: 'insensitive' as const } })),
      },
    });
  }

  const serialNumber = serialIdentityValue(input.serialNumber);
  if (serialNumber) {
    // Serial numbers are not globally unique across tenants. Do not merge on a
    // serial without company scope, and do not weaken a failed strong match to
    // hostname (which could otherwise merge a replacement machine).
    if (input.companyId == null && !normalizeCompanyName(input.companyName)) return null;
    const candidates = await db.device.findMany({
      where: {
        serialNumber: { equals: serialNumber, mode: 'insensitive' },
      },
      orderBy: { id: 'asc' },
    });
    return companyScopedCandidate(candidates, input);
  }

  if (input.hostname?.trim() && (input.companyId != null || normalizeCompanyName(input.companyName))) {
    const candidates = await db.device.findMany({
      where: {
        hostname: { equals: input.hostname.trim(), mode: 'insensitive' },
      },
      orderBy: { id: 'asc' },
    });
    return companyScopedCandidate(candidates, input);
  }

  return null;
}

/**
 * Populate the multi-provider table for devices created before 2.1.0. This is
 * run before the HTTP server starts so legacy primary references cannot be
 * shadowed by a newly-added secondary reference during an upgrade.
 */
export async function backfillLegacyExternalRefs() {
  const legacyDevices = await prisma.device.findMany({
    where: {
      externalId: { not: null },
      externalProvider: { not: null },
    },
    select: { id: true },
  });
  if (legacyDevices.length === 0) return 0;

  let created = 0;
  for (const device of legacyDevices) {
    const result = await withIdentityTransaction(async (tx) => {
      const current = await tx.device.findUnique({
        where: { id: device.id },
        select: {
          id: true,
          externalId: true,
          externalProvider: true,
          metadata: true,
          firstSeenAt: true,
          lastSeenAt: true,
        },
      });
      if (!current?.externalId || !current.externalProvider) return { created: false };
      return upsertExternalRefTx(tx, current.id, {
        provider: current.externalProvider,
        externalId: current.externalId,
        metadata: current.metadata ?? undefined,
        firstSeenAt: current.firstSeenAt,
        lastSeenAt: current.lastSeenAt,
      });
    });
    if (result.created) created += 1;
  }
  return created;
}

function externalClaimError(provider: string, externalId: string, deviceId: number) {
  return new Error(`${provider} device ${externalId} is already linked to device ${deviceId}`);
}

async function findExternalClaim(db: DeviceStore, provider: string, externalId: string) {
  const ref = await db.deviceExternalRef.findUnique({
    where: { provider_externalId: { provider, externalId } },
  });
  const legacy = await db.device.findUnique({
    where: { externalId_externalProvider: { externalId, externalProvider: provider } },
  });
  if (ref && legacy && ref.deviceId !== legacy.id) {
    throw new Error(
      `${provider} device ${externalId} has conflicting claims on devices ${ref.deviceId} and ${legacy.id}`,
    );
  }
  return { ref, legacy, deviceId: ref?.deviceId ?? legacy?.id ?? null };
}

async function upsertExternalRefTx(db: DeviceStore, deviceId: number, input: ExternalRefInput) {
  const provider = input.provider.trim();
  const externalId = input.externalId.trim();
  if (!provider || !externalId) throw new Error('external id and provider are required');
  const firstSeenAt = dateValue(input.firstSeenAt);
  const lastSeenAt = dateValue(input.lastSeenAt);
  const metadata = jsonValue(input.metadata);

  const owned = await db.deviceExternalRef.findUnique({
    where: { deviceId_provider: { deviceId, provider } },
  });
  if (owned) {
    // Detect a legacy claim for the old id before replacing it. Silently
    // moving this row would otherwise hide an existing cross-table split.
    const oldClaim = await findExternalClaim(db, provider, owned.externalId);
    if (oldClaim.deviceId !== deviceId) throw externalClaimError(provider, owned.externalId, oldClaim.deviceId!);

    const desiredClaim = owned.externalId === externalId
      ? oldClaim
      : await findExternalClaim(db, provider, externalId);
    if (desiredClaim.deviceId != null && desiredClaim.deviceId !== deviceId) {
      throw externalClaimError(provider, externalId, desiredClaim.deviceId);
    }
    const timestamps = monotonicTimestampPatch(owned, { firstSeenAt, lastSeenAt });
    const ref = await db.deviceExternalRef.update({
      where: { id: owned.id },
      data: {
        externalId,
        ...(metadata === undefined ? {} : { metadata }),
        ...timestamps,
      },
    });
    return { ref, created: false };
  }

  const claim = await findExternalClaim(db, provider, externalId);
  if (claim.deviceId != null && claim.deviceId !== deviceId) {
    throw externalClaimError(provider, externalId, claim.deviceId);
  }
  if (claim.ref) return { ref: claim.ref, created: false };

  const ref = await db.deviceExternalRef.create({
    data: {
      deviceId,
      provider,
      externalId,
      metadata,
      firstSeenAt: firstSeenAt ?? undefined,
      lastSeenAt,
    },
  });
  return { ref, created: true };
}

/** Upsert an observation from an RMM/probe and merge matching physical assets. */
export async function upsertExternal(
  externalId: string,
  externalProvider: string,
  input: CreateDeviceInput,
  actorSub: string
) {
  externalId = externalId.trim();
  externalProvider = externalProvider.trim();
  if (!externalId || !externalProvider) throw new Error('external id and provider are required');
  const observedAt = input.lastSeenAt ?? new Date();

  const result = await withIdentityTransaction(async (tx) => {
    const claim = await findExternalClaim(tx, externalProvider, externalId);
    const existing = claim.deviceId != null
      ? await tx.device.findUnique({ where: { id: claim.deviceId } })
      : await findByPhysicalIdentity(tx, input);

    if (existing) {
      const currentPrimary = normalizedPrimaryIdentity(existing.externalProvider, existing.externalId);
      if (currentPrimary) {
        await findExternalClaim(tx, currentPrimary.provider, currentPrimary.externalId);
      }
      const primaryProvider = currentPrimary?.provider === externalProvider;
      const adoptingPrimary = currentPrimary === null;
      const merged = mergeExternalObservation(existing, input, primaryProvider) as UpdateDeviceInput;
      if (primaryProvider && input.metadata !== undefined) merged.metadata = input.metadata;
      const refMetadata = (primaryProvider || adoptingPrimary) && input.metadata === undefined
        ? existing.metadata
        : input.metadata;

      const { ref, created: refCreated } = await upsertExternalRefTx(tx, existing.id, {
        provider: externalProvider,
        externalId,
        metadata: refMetadata,
        firstSeenAt: input.firstSeenAt,
        lastSeenAt: observedAt,
      });
      const {
        externalId: _externalId,
        externalProvider: _externalProvider,
        ...safeData
      } = toData(enrich(merged, existing));
      if (primaryProvider || adoptingPrimary) {
        Object.assign(safeData, {
          externalId: ref.externalId,
          externalProvider: ref.provider,
          ...(adoptingPrimary
            ? { source: input.source ?? sourceForProvider(ref.provider) }
            : {}),
        });
      }
      const device = await tx.device.update({ where: { id: existing.id }, data: safeData });
      return {
        before: existing,
        device,
        created: false,
        secondaryRefCreated: !primaryProvider && !adoptingPrimary && refCreated,
      };
    }

    const enriched = enrich(input);
    const device = await tx.device.create({
      data: {
        ...toData(enriched),
        source: input.source ?? sourceForProvider(externalProvider),
        externalId,
        externalProvider,
      },
    });
    await upsertExternalRefTx(tx, device.id, {
      provider: externalProvider,
      externalId,
      metadata: input.metadata,
      firstSeenAt: input.firstSeenAt,
      lastSeenAt: observedAt,
    });
    return { before: null, device, created: true, secondaryRefCreated: false };
  });

  await audit.record({
    entityType: 'device',
    entityId: result.device.id,
    action: result.created ? 'create' : 'update',
    changedBy: actorSub,
    ...(result.before
      ? { oldValue: result.before as unknown as Record<string, unknown> }
      : {}),
    newValue: result.device as unknown as Record<string, unknown>,
  });
  if (result.secondaryRefCreated) {
    await audit.record({
      entityType: 'device',
      entityId: result.device.id,
      action: 'sync',
      changedBy: actorSub,
      newValue: { externalRef: { provider: externalProvider, externalId } },
    });
  }
  const refreshed = await getById(result.device.id);
  if (!refreshed) throw new Error(`Device ${result.device.id} disappeared during sync`);
  return { device: refreshed, created: result.created };
}

export function listExternalRefs(deviceId: number) {
  return prisma.deviceExternalRef.findMany({
    where: { deviceId },
    orderBy: [{ provider: 'asc' }, { id: 'asc' }],
  });
}

export async function getExternalRefForProvider(deviceId: number, provider?: string) {
  if (provider) {
    return prisma.deviceExternalRef.findUnique({
      where: { deviceId_provider: { deviceId, provider } },
    });
  }
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) return null;
  if (device.externalProvider) {
    const primary = await prisma.deviceExternalRef.findUnique({
      where: { deviceId_provider: { deviceId, provider: device.externalProvider } },
    });
    if (primary) return primary;
  }
  return prisma.deviceExternalRef.findFirst({ where: { deviceId }, orderBy: { id: 'asc' } });
}

export async function addExternalRef(deviceId: number, input: ExternalRefInput, actorSub: string) {
  const result = await withIdentityTransaction(async (tx) => {
    const device = await tx.device.findUnique({ where: { id: deviceId } });
    if (!device) return null;
    const currentPrimary = normalizedPrimaryIdentity(device.externalProvider, device.externalId);
    if (currentPrimary) {
      await findExternalClaim(tx, currentPrimary.provider, currentPrimary.externalId);
    }
    const inputProvider = input.provider.trim();
    const refMetadata = input.metadata === undefined
      && (!currentPrimary || currentPrimary.provider === inputProvider)
      ? device.metadata
      : input.metadata;
    const { ref } = await upsertExternalRefTx(tx, deviceId, { ...input, metadata: refMetadata });
    if (!currentPrimary || currentPrimary.provider === ref.provider) {
      await tx.device.update({
        where: { id: deviceId },
        data: {
          externalProvider: ref.provider,
          externalId: ref.externalId,
          metadata: ref.metadata === null ? Prisma.JsonNull : ref.metadata,
          ...(!currentPrimary ? { source: sourceForProvider(ref.provider) } : {}),
        },
      });
    }
    return { device, ref };
  });
  if (!result) return null;
  await audit.record({
    entityType: 'device',
    entityId: deviceId,
    action: 'update',
    changedBy: actorSub,
    newValue: { externalRef: { provider: result.ref.provider, externalId: result.ref.externalId } },
  });
  return result.ref;
}

export async function removeExternalRef(deviceId: number, refId: number, actorSub: string) {
  const result = await withIdentityTransaction(async (tx) => {
    const ref = await tx.deviceExternalRef.findFirst({ where: { id: refId, deviceId } });
    if (!ref) return null;
    const device = await tx.device.findUnique({ where: { id: deviceId } });
    if (!device) return null;
    await findExternalClaim(tx, ref.provider, ref.externalId);
    const currentPrimary = normalizedPrimaryIdentity(device.externalProvider, device.externalId);

    await tx.deviceExternalRef.delete({ where: { id: refId } });
    if (currentPrimary?.provider === ref.provider) {
      const next = await tx.deviceExternalRef.findFirst({ where: { deviceId }, orderBy: { id: 'asc' } });
      if (next) await findExternalClaim(tx, next.provider, next.externalId);
      await tx.device.update({
        where: { id: deviceId },
        data: next
          ? {
            externalProvider: next.provider,
            externalId: next.externalId,
            metadata: next.metadata === null ? Prisma.JsonNull : next.metadata,
            source: sourceForProvider(next.provider),
          }
          : {
            externalProvider: null,
            externalId: null,
            metadata: Prisma.JsonNull,
            source: 'local',
          },
      });
    }
    return { ref };
  });
  if (!result) return false;

  await audit.record({
    entityType: 'device',
    entityId: deviceId,
    action: 'update',
    changedBy: actorSub,
    oldValue: { externalRef: { provider: result.ref.provider, externalId: result.ref.externalId } },
  });
  return true;
}

// --- ticket <-> device linking ---

export async function listForTicket(ticketId: number) {
  const links = await prisma.deviceLink.findMany({
    where: { ticketId },
    include: { device: { include: deviceInclude } },
    orderBy: { createdAt: 'asc' },
  });
  return links.map((l) => l.device);
}

export async function link(ticketId: number, deviceId: number, actorSub: string) {
  const link = await prisma.deviceLink.upsert({
    where: { ticketId_deviceId: { ticketId, deviceId } },
    create: { ticketId, deviceId },
    update: {},
  });

  await audit.record({
    entityType: 'device',
    entityId: deviceId,
    action: 'update',
    changedBy: actorSub,
    newValue: { linkedToTicket: ticketId },
  });

  return link;
}

export async function unlink(ticketId: number, deviceId: number, actorSub: string) {
  const deleted = await prisma.deviceLink.deleteMany({ where: { ticketId, deviceId } });
  if (deleted.count === 0) return false;

  await audit.record({
    entityType: 'device',
    entityId: deviceId,
    action: 'update',
    changedBy: actorSub,
    oldValue: { linkedToTicket: ticketId },
  });

  return true;
}
