import { terminalStatusForResult } from './scriptResult';

describe('terminalStatusForResult', () => {
  it.each([
    ['queued', null],
    ['running', null],
    ['success', 'success'],
    ['error', 'error'],
  ] as const)('maps %s without inventing a terminal result', (status, expected) => {
    expect(terminalStatusForResult({ invocationId: 'remote-1', status })).toBe(expected);
  });

  it('never records a non-zero exit code as success', () => {
    expect(terminalStatusForResult({ invocationId: 'remote-1', status: 'success', exitCode: 7 })).toBe('error');
  });
});
