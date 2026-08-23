/**
 * Real-Postgres proof that the migration-owned relational schema provides
 * every table and column required by the separately owned pgExtras layer.
 */
import type { FastifyBaseLogger } from 'fastify';
import { ensurePgExtras } from './pgExtras';
import { prisma } from './prisma';

const describePostgres =
  process.env.ANCHORDESK_POSTGRES_INTEGRATION === '1' ? describe : describe.skip;

describePostgres('Postgres extras against the migration-built schema', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('ensures every invariant and optional object idempotently', async () => {
    const info = jest.fn();
    const warn = jest.fn();
    const logger = { info, warn } as unknown as FastifyBaseLogger;

    await expect(ensurePgExtras(logger)).resolves.toBeUndefined();
    expect(info).toHaveBeenNthCalledWith(
      1,
      { optionalFailures: 0 },
      'Critical Postgres invariants and optional extras ensured',
    );

    await expect(ensurePgExtras(logger)).resolves.toBeUndefined();
    expect(info).toHaveBeenNthCalledWith(
      2,
      { optionalFailures: 0 },
      'Critical Postgres invariants and optional extras ensured',
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
