jest.mock('./prisma', () => ({
  prisma: {
    $executeRawUnsafe: jest.fn(),
    $queryRawUnsafe: jest.fn(),
  },
}));

jest.mock('../config/config', () => ({
  config: { ticketNumberDigits: 5 },
}));

import { FastifyBaseLogger } from 'fastify';
import { prisma } from './prisma';
import {
  CriticalPgInvariantError,
  ensureLegacyExternalIdentityInvariant,
  ensurePgExtras,
  ensureRuntimeDependencies,
  LEGACY_EXTERNAL_IDENTITY_INDEX_NAME,
  LEGACY_EXTERNAL_IDENTITY_INDEX_SQL,
  PG_TRGM_EXTENSION_SQL,
  TICKET_NUMBER_SEQUENCE_SQL,
} from './pgExtras';

const db = prisma as unknown as {
  $executeRawUnsafe: jest.Mock;
  $queryRawUnsafe: jest.Mock;
};

function validIndex(overrides: Record<string, unknown> = {}) {
  return {
    is_unique: true,
    is_valid: true,
    is_ready: true,
    access_method: 'btree',
    key_columns: ['external_id', 'external_provider'],
    predicate:
      '((sync_connection_id IS NULL) AND (external_id IS NOT NULL) AND (external_provider IS NOT NULL))',
    ...overrides,
  };
}

function validRuntime(overrides: Record<string, unknown> = {}) {
  return {
    has_ticket_number_sequence: true,
    has_pg_trgm: true,
    ...overrides,
  };
}

function logger() {
  return {
    warn: jest.fn(),
    info: jest.fn(),
  } as unknown as FastifyBaseLogger;
}

describe('critical legacy external identity invariant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.$executeRawUnsafe.mockResolvedValue(0);
    db.$queryRawUnsafe.mockResolvedValue([validIndex()]);
  });

  it('creates the partial unique index and validates its catalog definition', async () => {
    await expect(
      ensureLegacyExternalIdentityInvariant(),
    ).resolves.toBeUndefined();

    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
      LEGACY_EXTERNAL_IDENTITY_INDEX_SQL,
    );
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(db.$queryRawUnsafe.mock.calls[0][0]).toContain(
      LEGACY_EXTERNAL_IDENTITY_INDEX_NAME,
    );
  });

  it.each([
    ['missing', []],
    ['not unique', [validIndex({ is_unique: false })]],
    ['not valid', [validIndex({ is_valid: false })]],
    ['not ready', [validIndex({ is_ready: false })]],
    ['wrong access method', [validIndex({ access_method: 'hash' })]],
    [
      'wrong key order',
      [validIndex({ key_columns: ['external_provider', 'external_id'] })],
    ],
    [
      'wrong predicate',
      [
        validIndex({
          predicate:
            '(sync_connection_id IS NULL) AND (external_id IS NOT NULL)',
        }),
      ],
    ],
  ])('fails closed when the index is %s', async (_case, rows) => {
    db.$queryRawUnsafe.mockResolvedValue(rows);

    await expect(
      ensureLegacyExternalIdentityInvariant(),
    ).rejects.toBeInstanceOf(CriticalPgInvariantError);
  });

  it('propagates index creation failures instead of attempting optional extras', async () => {
    const failure = new Error('duplicate legacy identity');
    db.$executeRawUnsafe
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(failure);
    db.$queryRawUnsafe.mockResolvedValueOnce([validRuntime()]);
    const log = logger();

    await expect(ensurePgExtras(log)).rejects.toBe(failure);
    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('critical runtime dependencies', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.$executeRawUnsafe.mockResolvedValue(0);
    db.$queryRawUnsafe.mockResolvedValue([validRuntime()]);
  });

  it('creates and catalog-validates the ticket sequence and pg_trgm extension', async () => {
    await expect(ensureRuntimeDependencies()).resolves.toBeUndefined();
    expect(db.$executeRawUnsafe.mock.calls.map(([sql]) => sql)).toEqual([
      TICKET_NUMBER_SEQUENCE_SQL,
      PG_TRGM_EXTENSION_SQL,
    ]);
    expect(db.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(db.$queryRawUnsafe.mock.calls[0][0]).toContain(
      "object.relname = 'ticket_number_seq'"
    );
    expect(db.$queryRawUnsafe.mock.calls[0][0]).toContain("extname = 'pg_trgm'");
  });

  it.each([
    ['the sequence is absent', { has_ticket_number_sequence: false }],
    ['pg_trgm is absent', { has_pg_trgm: false }],
  ])('fails closed when %s', async (_case, overrides) => {
    db.$queryRawUnsafe.mockResolvedValue([validRuntime(overrides)]);
    await expect(ensureRuntimeDependencies()).rejects.toBeInstanceOf(
      CriticalPgInvariantError
    );
  });
});

describe('optional Postgres extras', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.$queryRawUnsafe
      .mockResolvedValueOnce([validRuntime()])
      .mockResolvedValueOnce([validIndex()])
      .mockResolvedValueOnce([{ enabled: 'O' }]);
  });

  it('logs an optional failure and continues through the remaining statements', async () => {
    db.$executeRawUnsafe
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockRejectedValueOnce(new Error('optional index unavailable'))
      .mockResolvedValue(0);
    const log = logger();

    await expect(ensurePgExtras(log)).resolves.toBeUndefined();

    expect(db.$executeRawUnsafe.mock.calls[2][0]).toBe(
      LEGACY_EXTERNAL_IDENTITY_INDEX_SQL,
    );
    expect(db.$executeRawUnsafe.mock.calls.length).toBeGreaterThan(7);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        sql: expect.any(String),
      }),
      'Failed to ensure optional Postgres extra',
    );
    expect(log.info).toHaveBeenCalledWith(
      { optionalFailures: 1 },
      'Critical Postgres invariants verified; some optional extras were unavailable',
    );
  });
});
