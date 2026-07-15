/**
 * DattoRmmRunner — ScriptRunner backed by Datto RMM quick jobs.
 *
 * Datto runs a "component" as an asynchronous quick job (no wait mode), so run()
 * returns the provider acknowledgement. AnchorDesk persists its job UID and the
 * scheduler polls getResult(); it never re-submits the component to check status.
 * The script ref is the component's UID (copied from the component page in Datto
 * RMM — Datto exposes no component catalogue over the API). Positional args are
 * not passed: Datto components take named variables, which this lean runner does
 * not collect.
 *
 * GoF pattern: Strategy (implements ScriptRunner)
 */

import { ScriptRunner, ScriptInvocation, ScriptResult } from './ScriptRunner';
import * as datto from '../services/dattoService';

const SUCCESS = new Set(['completed', 'succeeded', 'success']);
const FAILURE = new Set(['failed', 'error', 'cancelled', 'canceled', 'stopped']);

export function dattoResultStatus(status: unknown): ScriptResult['status'] {
  const normalized = String(status ?? 'active').toLowerCase();
  if (SUCCESS.has(normalized)) return 'success';
  if (FAILURE.has(normalized)) return 'error';
  return 'running';
}

export class DattoRmmRunner implements ScriptRunner {
  readonly name = 'datto_rmm';

  async run(invocation: ScriptInvocation): Promise<ScriptResult> {
    const componentUid = invocation.script.trim();
    if (!componentUid) throw new Error('Datto RMM script ref must be a component UID');

    const jobUid = await datto.createQuickJob(invocation.externalDeviceId, {
      componentUid,
      jobName: 'AnchorDesk Quick Job',
    });

    return {
      invocationId: jobUid,
      status: 'queued',
      output: `Datto RMM quick job ${jobUid} queued. AnchorDesk will poll Datto for the terminal result.`,
    };
  }

  async getResult(invocationId: string): Promise<ScriptResult> {
    const job = await datto.getJob(invocationId);
    const status = String(job.status ?? 'active').toLowerCase();
    return {
      invocationId,
      status: dattoResultStatus(status),
      output: `Datto RMM quick job ${invocationId}: ${status}`,
    };
  }
}
