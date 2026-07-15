/**
 * TacticalRmmRunner — ScriptRunner backed by Tactical RMM.
 *
 * run() executes a script on the agent in Tactical's synchronous "wait" mode and
 * returns the output. Tactical's API has no native future-scheduling for ad-hoc
 * runs, so schedule() is handled by our own scriptScheduler (it persists a job
 * with scheduledFor and run()s it when due).
 *
 * GoF pattern: Strategy (implements ScriptRunner)
 */

import { ScriptRunner, ScriptInvocation, ScriptResult } from './ScriptRunner';
import * as tactical from '../services/tacticalService';

export class TacticalRmmRunner implements ScriptRunner {
  readonly name = 'tactical_rmm';

  async run(invocation: ScriptInvocation): Promise<ScriptResult> {
    const scriptPk = Number(invocation.script);
    if (!Number.isInteger(scriptPk) || scriptPk <= 0) {
      throw new Error(`Tactical script ref must be a numeric pk, got "${invocation.script}"`);
    }

    const output = await tactical.runScript(invocation.externalDeviceId, {
      script: scriptPk,
      args: invocation.args,
      timeout: invocation.timeout,
    });

    return {
      invocationId: `${invocation.externalDeviceId}:${scriptPk}:${Date.now()}`,
      status: 'success',
      output,
    };
  }
}
