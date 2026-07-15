jest.mock('../db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    device: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    deviceExternalRef: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('./auditRepository', () => ({
  record: jest.fn(),
}));

import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import {
  addExternalRef,
  removeExternalRef,
  update,
  upsertExternal,
} from './deviceRepository';

const root = prisma as unknown as {
  $transaction: jest.Mock;
  device: { findUnique: jest.Mock; findMany: jest.Mock };
  deviceExternalRef: { findUnique: jest.Mock };
};
const auditRecord = audit.record as jest.Mock;

function device(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    hostname: 'primary-host',
    displayName: null,
    ipAddress: '10.0.0.5',
    macAddress: null,
    vendor: null,
    assetTag: null,
    serialNumber: 'SERIAL-1',
    manufacturer: null,
    model: null,
    location: null,
    purchaseDate: null,
    warrantyExpiresAt: null,
    notes: null,
    os: null,
    deviceType: 'workstation',
    openPorts: null,
    status: 'offline',
    companyName: 'Acme North',
    companyId: null,
    source: 'datto_rmm',
    probeId: null,
    externalId: 'datto-old',
    externalProvider: 'datto_rmm',
    metadata: { primary: true },
    firstSeenAt: new Date('2026-01-02T00:00:00Z'),
    lastSeenAt: new Date('2026-01-03T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-03T00:00:00Z'),
    ...overrides,
  };
}

function ref(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    deviceId: 1,
    provider: 'datto_rmm',
    externalId: 'datto-old',
    metadata: { primary: true },
    firstSeenAt: new Date('2026-01-02T00:00:00Z'),
    lastSeenAt: new Date('2026-01-03T00:00:00Z'),
    createdAt: new Date('2026-01-02T00:00:00Z'),
    updatedAt: new Date('2026-01-03T00:00:00Z'),
    ...overrides,
  };
}

function transaction() {
  return {
    device: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    deviceExternalRef: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function useTransaction(tx: ReturnType<typeof transaction>) {
  root.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx));
}

describe('deviceRepository identity invariants', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditRecord.mockResolvedValue(undefined);
  });

  it('replaces a primary child ref and mirrors it to the legacy identity without regressing timestamps', async () => {
    const tx = transaction();
    const current = device();
    const currentRef = ref();
    const replacedRef = ref({
      externalId: 'datto-new',
      metadata: { generation: 2 },
      firstSeenAt: new Date('2026-01-01T00:00:00Z'),
    });
    useTransaction(tx);
    tx.device.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 1) return current;
      const identity = where.externalId_externalProvider;
      return identity?.externalId === 'datto-old' ? current : null;
    });
    tx.deviceExternalRef.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.deviceId_provider) return currentRef;
      return where.provider_externalId?.externalId === 'datto-old' ? currentRef : null;
    });
    tx.deviceExternalRef.update.mockResolvedValue(replacedRef);
    tx.device.update.mockResolvedValue({ ...current, externalId: 'datto-new' });

    const result = await addExternalRef(1, {
      provider: 'datto_rmm',
      externalId: 'datto-new',
      metadata: { generation: 2 },
      firstSeenAt: '2026-01-01T00:00:00Z',
      lastSeenAt: '2026-01-02T00:00:00Z',
    }, 'tester');

    expect(result?.externalId).toBe('datto-new');
    expect(tx.deviceExternalRef.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        externalId: 'datto-new',
        firstSeenAt: new Date('2026-01-01T00:00:00Z'),
      }),
    }));
    expect(tx.deviceExternalRef.update.mock.calls[0][0].data).not.toHaveProperty('lastSeenAt');
    expect(tx.device.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        externalProvider: 'datto_rmm',
        externalId: 'datto-new',
        metadata: { generation: 2 },
      }),
    });
  });

  it('rejects an external identity claimed by another device legacy row', async () => {
    const tx = transaction();
    const current = device();
    const currentRef = ref();
    useTransaction(tx);
    tx.device.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 1) return current;
      const identity = where.externalId_externalProvider;
      if (identity?.externalId === 'datto-old') return current;
      if (identity?.externalId === 'ninja-claimed') return device({ id: 2 });
      return null;
    });
    tx.deviceExternalRef.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.deviceId_provider?.provider === 'datto_rmm') return currentRef;
      if (where.provider_externalId?.externalId === 'datto-old') return currentRef;
      return null;
    });

    await expect(addExternalRef(1, {
      provider: 'ninjaone',
      externalId: 'ninja-claimed',
    }, 'tester')).rejects.toThrow('already linked to device 2');
    expect(tx.deviceExternalRef.create).not.toHaveBeenCalled();
  });

  it('fails loudly when the legacy and child tables already split one provider identity', async () => {
    const tx = transaction();
    const splitRef = ref({ provider: 'ninjaone', externalId: 'split-id' });
    useTransaction(tx);
    tx.deviceExternalRef.findUnique.mockResolvedValue(splitRef);
    tx.device.findUnique.mockResolvedValue(device({ id: 2, externalProvider: 'ninjaone', externalId: 'split-id' }));

    await expect(upsertExternal('split-id', 'ninjaone', {}, 'tester')).rejects.toThrow(
      'conflicting claims on devices 1 and 2',
    );
    expect(tx.device.update).not.toHaveBeenCalled();
  });

  it('blocks primary identity mutation through the generic device update', async () => {
    const tx = transaction();
    useTransaction(tx);
    tx.device.findUnique.mockResolvedValue(device());

    await expect(update(1, { externalId: 'bypass-attempt' }, 'tester')).rejects.toThrow(
      'use external-reference endpoints',
    );
    expect(tx.device.update).not.toHaveBeenCalled();
  });

  it('promotes the next child ref when the primary is removed', async () => {
    const tx = transaction();
    // Simulate a pre-fix mismatch: provider still marks this as primary, but
    // the legacy id was not mirrored when the child id changed.
    const current = device({ externalId: 'stale-legacy-id' });
    const primaryRef = ref();
    const nextRef = ref({
      id: 11,
      provider: 'ninjaone',
      externalId: 'ninja-1',
      metadata: { site: 'north' },
    });
    useTransaction(tx);
    tx.deviceExternalRef.findFirst
      .mockResolvedValueOnce(primaryRef)
      .mockResolvedValueOnce(nextRef);
    tx.device.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 1) return current;
      return null;
    });
    tx.deviceExternalRef.findUnique.mockImplementation(async ({ where }: any) => {
      const id = where.provider_externalId?.externalId;
      if (id === 'datto-old') return primaryRef;
      if (id === 'ninja-1') return nextRef;
      return null;
    });
    tx.deviceExternalRef.delete.mockResolvedValue(primaryRef);
    tx.device.update.mockResolvedValue({ ...current, externalProvider: 'ninjaone', externalId: 'ninja-1' });

    await expect(removeExternalRef(1, 10, 'tester')).resolves.toBe(true);
    expect(tx.device.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        externalProvider: 'ninjaone',
        externalId: 'ninja-1',
        metadata: { site: 'north' },
        source: 'ninjaone',
      },
    });
  });

  it('uses normalized company name as a fallback when company ids do not match', async () => {
    const tx = transaction();
    const current = device({ companyName: '  ACME   North ' });
    const primaryRef = ref();
    const secondaryRef = ref({ id: 12, provider: 'ninjaone', externalId: 'ninja-2' });
    useTransaction(tx);
    tx.device.findMany.mockResolvedValue([current]);
    tx.device.findUnique.mockImplementation(async ({ where }: any) => {
      const identity = where.externalId_externalProvider;
      return identity?.externalId === 'datto-old' ? current : null;
    });
    tx.deviceExternalRef.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.provider_externalId?.externalId === 'datto-old') return primaryRef;
      return null;
    });
    tx.deviceExternalRef.create.mockResolvedValue(secondaryRef);
    tx.device.update.mockResolvedValue(current);
    root.device.findUnique.mockResolvedValue({ ...current, externalRefs: [primaryRef, secondaryRef] });

    const result = await upsertExternal('ninja-2', 'ninjaone', {
      serialNumber: 'SERIAL-1',
      companyId: 99,
      companyName: 'acme north',
      hostname: 'secondary-name',
    }, 'tester');

    expect(result.created).toBe(false);
    expect(tx.device.create).not.toHaveBeenCalled();
    expect(tx.device.update.mock.calls[0][0].data.hostname).toBeUndefined();
  });

  it('keeps an already-linked secondary provider fill-only on repeat sync', async () => {
    const tx = transaction();
    const current = device();
    const secondaryRef = ref({ id: 12, provider: 'ninjaone', externalId: 'ninja-2' });
    useTransaction(tx);
    tx.device.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 1) return current;
      const identity = where.externalId_externalProvider;
      return identity?.externalId === 'datto-old' ? current : null;
    });
    tx.deviceExternalRef.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.deviceId_provider?.provider === 'ninjaone') return secondaryRef;
      if (where.provider_externalId?.externalId === 'ninja-2') return secondaryRef;
      return null;
    });
    tx.deviceExternalRef.update.mockResolvedValue(secondaryRef);
    tx.device.update.mockResolvedValue(current);
    root.device.findUnique.mockResolvedValue({ ...current, externalRefs: [secondaryRef] });

    await upsertExternal('ninja-2', 'ninjaone', {
      hostname: 'secondary-overwrite',
      ipAddress: '10.0.0.99',
      status: 'online',
      lastSeenAt: new Date('2026-02-01T00:00:00Z'),
    }, 'tester');

    const data = tx.device.update.mock.calls[0][0].data;
    expect(data.hostname).toBeUndefined();
    expect(data.ipAddress).toBeUndefined();
    expect(data.status).toBeUndefined();
    expect(data.lastSeenAt).toBeUndefined();
  });

  it('retries a serialization conflict before applying an update', async () => {
    const tx = transaction();
    root.$transaction
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(async (callback: (client: unknown) => unknown) => callback(tx));
    tx.device.findUnique.mockResolvedValue(device());
    tx.device.update.mockResolvedValue(device({ location: 'Rack 4' }));
    root.device.findUnique.mockResolvedValue(device({ location: 'Rack 4' }));

    await expect(update(1, { location: 'Rack 4' }, 'tester')).resolves.toEqual(
      expect.objectContaining({ location: 'Rack 4' }),
    );
    expect(root.$transaction).toHaveBeenCalledTimes(2);
  });
});
