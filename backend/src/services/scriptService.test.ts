jest.mock('../db/prisma', () => ({
  prisma: { device: { findUnique: jest.fn() } },
}));
jest.mock('../repositories/scriptJobRepository', () => ({
  create: jest.fn(),
  claimQueued: jest.fn(),
  getById: jest.fn(),
  markProgress: jest.fn(),
  markFinished: jest.fn(),
}));
jest.mock('../repositories/noteRepository', () => ({ create: jest.fn() }));
jest.mock('../runners', () => ({ createScriptRunner: jest.fn() }));

import { prisma } from '../db/prisma';
import { createScriptRunner } from '../runners';
import * as jobs from '../repositories/scriptJobRepository';
import { execute, runOrSchedule } from './scriptService';

const findDevice = prisma.device.findUnique as jest.Mock;
const runnerFactory = createScriptRunner as jest.Mock;
const createJob = jobs.create as jest.Mock;
const claimQueued = jobs.claimQueued as jest.Mock;
const getJob = jobs.getById as jest.Mock;
const markProgress = jobs.markProgress as jest.Mock;
const markFinished = jobs.markFinished as jest.Mock;

const queuedJob = {
  id: 10,
  deviceId: 2,
  ticketId: null,
  runner: 'tactical_rmm',
  externalDeviceId: 'pinned-agent',
  scriptRef: '17',
  scriptName: null,
  args: ['--safe'],
  timeoutSeconds: 45,
  invocationId: null,
  status: 'queued',
  output: null,
  exitCode: null,
  scheduledFor: null,
  createdBy: 'alice',
  createdAt: new Date(),
  startedAt: null,
  completedAt: null,
};

describe('scriptService execution safety', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not invoke a runner when another caller already claimed the job', async () => {
    claimQueued.mockResolvedValue(null);
    getJob.mockResolvedValue({ ...queuedJob, status: 'running' });

    await expect(execute(queuedJob.id)).resolves.toMatchObject({ status: 'running' });
    expect(findDevice).not.toHaveBeenCalled();
    expect(runnerFactory).not.toHaveBeenCalled();
  });

  it('forwards the pinned target and persisted timeout to the winning runner', async () => {
    claimQueued.mockResolvedValue({ ...queuedJob, status: 'running' });
    findDevice.mockResolvedValue({ id: 2, externalProvider: 'tactical_rmm', externalId: 'changed-agent', externalRefs: [] });
    const run = jest.fn().mockResolvedValue({ invocationId: 'remote-1', status: 'success', output: 'ok', exitCode: 0 });
    runnerFactory.mockReturnValue({ name: 'tactical_rmm', run });
    const finished = { ...queuedJob, status: 'success', output: 'ok', exitCode: 0 };
    markFinished.mockResolvedValue({ job: finished, transitioned: true });

    await expect(execute(queuedJob.id)).resolves.toMatchObject({ status: 'success' });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      externalDeviceId: 'pinned-agent',
      timeout: 45,
    }));
  });

  it('persists a nonterminal result as progress instead of success', async () => {
    claimQueued.mockResolvedValue({ ...queuedJob, status: 'running' });
    findDevice.mockResolvedValue({ id: 2, externalProvider: 'tactical_rmm', externalId: 'changed-agent', externalRefs: [] });
    runnerFactory.mockReturnValue({
      name: 'datto_rmm',
      run: jest.fn().mockResolvedValue({ invocationId: 'datto-job-1', status: 'running', output: 'active' }),
    });
    markProgress.mockResolvedValue({ ...queuedJob, status: 'running', invocationId: 'datto-job-1', output: 'active' });

    await expect(execute(queuedJob.id)).resolves.toMatchObject({ status: 'running', invocationId: 'datto-job-1' });
    expect(markProgress).toHaveBeenCalledWith(queuedJob.id, 'datto-job-1', 'active');
    expect(markFinished).not.toHaveBeenCalled();
  });

  it('persists supported timeouts when scheduling', async () => {
    findDevice.mockResolvedValue({
      id: 2,
      externalProvider: 'tactical_rmm',
      externalId: 'legacy-agent',
      externalRefs: [{ id: 1, provider: 'tactical_rmm', externalId: 'pinned-agent' }],
    });
    const scheduledFor = new Date(Date.now() + 60_000);
    createJob.mockResolvedValue({ ...queuedJob, scheduledFor });

    await runOrSchedule({ deviceId: 2, script: '17', timeout: 60, scheduledFor }, 'alice');
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({
      externalDeviceId: 'pinned-agent',
      timeoutSeconds: 60,
    }), 'alice');
  });

  it('rejects timeout for a provider that cannot enforce it', async () => {
    findDevice.mockResolvedValue({
      id: 2,
      externalProvider: 'datto_rmm',
      externalId: 'legacy-datto',
      externalRefs: [{ id: 1, provider: 'datto_rmm', externalId: 'datto-device' }],
    });

    await expect(runOrSchedule({ deviceId: 2, script: 'component', timeout: 30 }, 'alice'))
      .rejects.toThrow('timeout is not supported by datto_rmm');
    expect(createJob).not.toHaveBeenCalled();
  });
});
