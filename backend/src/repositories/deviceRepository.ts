import { DeviceSource, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import { classifyHost } from '../services/deviceClassify';
import { vendorForMac } from '../services/oui';

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

function toData(input: CreateDeviceInput) {
  return {
    hostname: input.hostname,
    displayName: input.displayName,
    ipAddress: input.ipAddress,
    macAddress: input.macAddress,
    vendor: input.vendor,
    os: input.os,
    deviceType: input.deviceType,
    openPorts: (input.openPorts as Prisma.InputJsonValue) ?? undefined,
    status: input.status,
    companyName: input.companyName,
    companyId: input.companyId ?? undefined,
    source: input.source,
    probeId: input.probeId,
    externalId: input.externalId,
    externalProvider: input.externalProvider,
    metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
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
  if (filters.source) where.source = filters.source;
  if (filters.status) where.status = filters.status;
  if (filters.probeId) where.probeId = filters.probeId;

  return prisma.device.findMany({
    where,
    orderBy: { lastSeenAt: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { probe: { select: { id: true, name: true, status: true } } },
  });
}

export async function getById(id: number) {
  return prisma.device.findUnique({
    where: { id },
    include: {
      probe: { select: { id: true, name: true, status: true } },
      ticketLinks: { include: { ticket: { select: { id: true, title: true, status: true } } } },
    },
  });
}

export async function create(input: CreateDeviceInput, actorSub: string) {
  input = enrich(input);
  const device = await prisma.device.create({
    data: { ...toData(input), source: input.source ?? 'local' },
  });

  await audit.record({
    entityType: 'device',
    entityId: device.id,
    action: 'create',
    changedBy: actorSub,
    newValue: device as unknown as Record<string, unknown>,
  });

  return device;
}

export async function update(id: number, input: UpdateDeviceInput, actorSub: string) {
  const before = await prisma.device.findUnique({ where: { id } });
  if (!before) return null;

  const device = await prisma.device.update({ where: { id }, data: toData(enrich(input, before)) });

  await audit.record({
    entityType: 'device',
    entityId: id,
    action: 'update',
    changedBy: actorSub,
    oldValue: before as unknown as Record<string, unknown>,
    newValue: device as unknown as Record<string, unknown>,
  });

  return device;
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

/** Upsert a device from an external source (RMM / netviz probe). Returns {device, created}. */
export async function upsertExternal(
  externalId: string,
  externalProvider: string,
  input: CreateDeviceInput,
  actorSub: string
) {
  const existing = await prisma.device.findUnique({
    where: { externalId_externalProvider: { externalId, externalProvider } },
  });

  if (existing) {
    const device = await update(existing.id, input, actorSub);
    return { device, created: false };
  }

  const device = await create({ ...input, externalId, externalProvider }, actorSub);
  return { device, created: true };
}

// --- ticket <-> device linking ---

export async function listForTicket(ticketId: number) {
  const links = await prisma.deviceLink.findMany({
    where: { ticketId },
    include: { device: { include: { probe: { select: { id: true, name: true, status: true } } } } },
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
