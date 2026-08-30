import { prisma } from '../src/db/prisma';
import * as receipts from '../src/repositories/intakeReceiptRepository';

if (process.env.ANCHORDESK_POSTGRES_INTEGRATION !== '1') {
  throw new Error(
    'PostgreSQL integration tests must be run through `npm run test:postgres`',
  );
}

describe('intake receipt concurrency against real PostgreSQL', () => {
  let tokenA: number;
  let tokenB: number;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `intake-postgres-${Date.now()}` },
    });
    const [a, b] = await Promise.all([
      prisma.apiToken.create({
        data: {
          userId: user.id,
          name: 'intake A',
          tokenHash: 'a'.repeat(64),
          prefix: 'adk_intake_a',
          scope: 'intake',
        },
      }),
      prisma.apiToken.create({
        data: {
          userId: user.id,
          name: 'intake B',
          tokenHash: 'b'.repeat(64),
          prefix: 'adk_intake_b',
          scope: 'intake',
        },
      }),
    ]);
    tokenA = a.id;
    tokenB = b.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('allows exactly one concurrent claimant for one credential/key pair', async () => {
    const outcomes = await Promise.all([
      receipts.claim(tokenA, 'concurrent-key'),
      receipts.claim(tokenA, 'concurrent-key'),
    ]);

    expect(outcomes.filter((result) => result.outcome === 'claimed')).toHaveLength(1);
    expect(outcomes.filter((result) => result.outcome === 'in-progress')).toHaveLength(1);
  });

  it('isolates identical key text between two credentials', async () => {
    const [a, b] = await Promise.all([
      receipts.claim(tokenA, 'same-text'),
      receipts.claim(tokenB, 'same-text'),
    ]);

    expect(a.outcome).toBe('claimed');
    expect(b.outcome).toBe('claimed');
  });

  it('reclaims only a stale incomplete claim and then accepts one new owner', async () => {
    const stale = await prisma.intakeCreateReceipt.create({
      data: {
        apiTokenId: tokenA,
        idempotencyKey: 'stale-key',
        createdAt: new Date(Date.now() - receipts.STALE_CLAIM_MS - 5_000),
      },
    });

    const reclaimed = await receipts.claim(tokenA, 'stale-key');
    expect(reclaimed.outcome).toBe('claimed');
    if (reclaimed.outcome !== 'claimed') throw new Error('expected reclaimed ownership');
    expect(reclaimed.receiptId).not.toBe(stale.id);
    await expect(
      prisma.intakeCreateReceipt.findUnique({ where: { id: stale.id } }),
    ).resolves.toBeNull();
  });

  it('keeps a completed frozen response during failure cleanup and replays it', async () => {
    const row = await prisma.intakeCreateReceipt.create({
      data: {
        apiTokenId: tokenA,
        idempotencyKey: 'completed-key',
        responseBody: { accepted: true, request: 'completed-key' },
      },
    });

    await receipts.fail(row.id);

    await expect(receipts.claim(tokenA, 'completed-key')).resolves.toEqual({
      outcome: 'replay',
      responseBody: { accepted: true, request: 'completed-key' },
    });
  });
});
