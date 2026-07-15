jest.mock('../services/dattoService', () => ({
  createQuickJob: jest.fn(),
  getJob: jest.fn(),
}));

import * as datto from '../services/dattoService';
import { DattoRmmRunner, dattoResultStatus } from './DattoRmmRunner';

const createQuickJob = datto.createQuickJob as jest.Mock;
const getJob = datto.getJob as jest.Mock;

describe('DattoRmmRunner', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a nonterminal acknowledgement without waiting or claiming success', async () => {
    createQuickJob.mockResolvedValue('job-123');
    const result = await new DattoRmmRunner().run({
      deviceId: 1,
      externalDeviceId: 'device-abc',
      script: 'component-xyz',
    });

    expect(createQuickJob).toHaveBeenCalledWith('device-abc', {
      componentUid: 'component-xyz',
      jobName: 'AnchorDesk Quick Job',
    });
    expect(result).toMatchObject({ invocationId: 'job-123', status: 'queued' });
    expect(getJob).not.toHaveBeenCalled();
  });

  it.each([
    ['completed', 'success'],
    ['succeeded', 'success'],
    ['failed', 'error'],
    ['cancelled', 'error'],
    ['stopped', 'error'],
    ['active', 'running'],
    ['unknown-provider-state', 'running'],
  ] as const)('maps Datto status %s to %s', (providerStatus, expected) => {
    expect(dattoResultStatus(providerStatus)).toBe(expected);
  });

  it('uses the same conservative mapping when polling', async () => {
    getJob.mockResolvedValue({ status: 'canceled' });
    await expect(new DattoRmmRunner().getResult('job-456')).resolves.toMatchObject({
      invocationId: 'job-456',
      status: 'error',
    });
  });
});
