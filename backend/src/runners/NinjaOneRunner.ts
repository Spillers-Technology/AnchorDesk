/**
 * NinjaOneRunner — ScriptRunner backed by NinjaOne (NinjaRMM).
 *
 * NinjaOne queues script runs and returns immediately (no synchronous wait mode),
 * so run() records the queue acknowledgement; the script's console output lives in
 * NinjaOne. The script ref is the numeric NinjaOne automation-script id.
 *
 * GoF pattern: Strategy (implements ScriptRunner)
 */

import { ScriptRunner, ScriptInvocation, ScriptResult } from './ScriptRunner';
import * as ninja from '../services/ninjaService';

export class NinjaOneRunner implements ScriptRunner {
  readonly name = 'ninjaone';

  async run(invocation: ScriptInvocation): Promise<ScriptResult> {
    const scriptId = Number(invocation.script);
    if (!Number.isInteger(scriptId) || scriptId <= 0) {
      throw new Error(`NinjaOne script ref must be a numeric script id, got "${invocation.script}"`);
    }

    const ack = await ninja.runScript(invocation.externalDeviceId, {
      scriptId,
      parameters: invocation.args?.join(' '),
    });

    return {
      invocationId: `${invocation.externalDeviceId}:${scriptId}:${Date.now()}`,
      status: 'queued',
      output: `Accepted by NinjaOne; completion status and output are available in the NinjaOne console.\n${ack}`.trim(),
    };
  }
}
