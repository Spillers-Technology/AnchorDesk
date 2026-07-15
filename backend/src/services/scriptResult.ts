import type { ScriptResult } from '../runners/ScriptRunner';

export type TerminalScriptJobStatus = 'success' | 'error';

/**
 * Map a runner result to a terminal local state. queued/running deliberately
 * remain nonterminal, and a non-zero exit code can never be recorded as success.
 */
export function terminalStatusForResult(result: ScriptResult): TerminalScriptJobStatus | null {
  if (result.status === 'error') return 'error';
  if (result.exitCode !== undefined && result.exitCode !== 0) return 'error';
  if (result.status === 'success') return 'success';
  return null;
}
