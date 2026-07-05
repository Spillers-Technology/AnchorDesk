/**
 * DattoRmmRunner — ScriptRunner backed by Datto RMM quick jobs.
 *
 * Datto runs a "component" as an asynchronous quick job (no wait mode), so run()
 * queues the job and polls its status a bounded number of times before returning.
 * The script ref is the component's UID (copied from the component page in Datto
 * RMM — Datto exposes no component catalogue over the API). Positional args are
 * not passed: Datto components take named variables, which this lean runner does
 * not collect.
 *
 * GoF pattern: Strategy (implements ScriptRunner)
 */

import { ScriptRunner, ScriptInvocation, ScriptResult } from './ScriptRunner';
import * as datto from '../services/dattoService';

const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 3000;
const TERMINAL = new Set(['completed', 'succeeded', 'success', 'failed', 'error', 'cancelled', 'canceled', 'stopped']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DattoRmmRunner implements ScriptRunner {
  readonly name = 'datto_rmm';

  async run(invocation: ScriptInvocation): Promise<ScriptResult> {
    const componentUid = invocation.script.trim();
    if (!componentUid) throw new Error('Datto RMM script ref must be a component UID');

    const jobUid = await datto.createQuickJob(invocation.externalDeviceId, {
      componentUid,
      jobName: 'AnchorDesk Quick Job',
    });

    let status = 'active';
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS);
      try {
        const job = await datto.getJob(jobUid);
        status = String(job.status ?? status).toLowerCase();
        if (TERMINAL.has(status)) break;
      } catch {
        // transient poll failure — keep trying until attempts run out
      }
    }

    const failed = status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled';
    const settled = TERMINAL.has(status);

    return {
      invocationId: jobUid,
      status: failed ? 'error' : settled ? 'success' : 'running',
      output: settled
        ? `Datto RMM quick job ${jobUid} finished with status "${status}". Full output is in Datto RMM.`
        : `Datto RMM quick job ${jobUid} queued (still "${status}" after polling). Check Datto RMM for the result.`,
    };
  }

  async getResult(invocationId: string): Promise<ScriptResult> {
    const job = await datto.getJob(invocationId);
    const status = String(job.status ?? 'active').toLowerCase();
    const failed = status === 'failed' || status === 'error';
    const settled = TERMINAL.has(status);
    return {
      invocationId,
      status: failed ? 'error' : settled ? 'success' : 'running',
      output: `Datto RMM quick job ${invocationId}: ${status}`,
    };
  }
}
