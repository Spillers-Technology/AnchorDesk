jest.mock('../db/prisma', () => ({
  prisma: {
    scriptJob: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));
jest.mock('./auditRepository', () => ({ record: jest.fn() }));

import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import * as repo from './scriptJobRepository';

const create = prisma.scriptJob.create as jest.Mock;
const updateMany = prisma.scriptJob.updateMany as jest.Mock;
const findUnique = prisma.scriptJob.findUnique as jest.Mock;
const recordAudit = audit.record as jest.Mock;

describe('scriptJobRepository safety transitions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('persists the pinned external id and timeout when queueing', async () => {
    const row = { id: 1, deviceId: 2, scriptRef: '17', scheduledFor: null };
    create.mockResolvedValue(row);
    recordAudit.mockResolvedValue(undefined);

    await repo.create({
      deviceId: 2,
      runner: 'tactical_rmm',
      externalDeviceId: 'agent-pinned',
      scriptRef: '17',
      timeoutSeconds: 45,
    }, 'alice');

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalDeviceId: 'agent-pinned',
        timeoutSeconds: 45,
        status: 'queued',
      }),
    });
  });

  it('claims with a queued-to-running compare-and-set', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue({ id: 9, status: 'running' });
    const before = new Date();

    await expect(repo.claimQueued(9)).resolves.toMatchObject({ id: 9, status: 'running' });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 9,
        status: 'queued',
        OR: [{ scheduledFor: null }, { scheduledFor: { lte: expect.any(Date) } }],
      },
      data: { status: 'running', startedAt: expect.any(Date) },
    });
    const claimWhere = updateMany.mock.calls[0][0].where;
    expect(claimWhere.OR[1].scheduledFor.lte.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('returns null to a losing claimant without loading work to execute', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.claimQueued(9)).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('finishes only a still-running row and reports whether this caller won', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue({ id: 9, status: 'success', invocationId: 'remote-9' });

    await expect(repo.markFinished(9, 'success', 'done', 0, 'remote-9')).resolves.toMatchObject({
      transitioned: true,
      job: { id: 9, status: 'success' },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 9, status: 'running' },
      data: expect.objectContaining({
        status: 'success',
        invocationId: 'remote-9',
        completedAt: expect.any(Date),
      }),
    });
  });
});
