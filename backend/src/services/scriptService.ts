/**
 * scriptService — orchestrates running scripts against devices.
 *
 * Resolves a local device to its RMM agent id, picks the right ScriptRunner via
 * the factory, records a ScriptJob, and (for immediate runs) executes it now.
 * Scheduled runs are left 'queued' for scriptScheduler to pick up when due.
 */

import { ScriptJob } from '@prisma/client';
import { prisma } from '../db/prisma';
import { createScriptRunner } from '../runners';
import type { ScriptResult } from '../runners/ScriptRunner';
import * as scriptJobRepo from '../repositories/scriptJobRepository';
import * as noteRepo from '../repositories/noteRepository';
import { terminalStatusForResult } from './scriptResult';

const RUNNABLE_PROVIDERS = ['tactical_rmm', 'ninjaone', 'datto_rmm'];
const MAX_STORED_OUTPUT = 1_000_000;

/**
 * Record a finished script job on its ticket's timeline so the run + output live
 * with the ticket (and stream in live via the note.added event). Output is kept
 * as HTML <pre> for readable rendering and capped so a noisy script can't bloat
 * the note. No-op for jobs not tied to a ticket.
 */
async function appendJobLog(job: ScriptJob): Promise<void> {
  if (!job.ticketId) return;
  const ok = job.status === 'success';
  const name = job.scriptName || job.scriptRef;
  const out = (job.output ?? '').slice(0, 20_000);
  const header = `Script "${name}" ${ok ? 'succeeded' : 'failed'}${job.exitCode != null ? ` (exit ${job.exitCode})` : ''}`;
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<p><strong>${escape(header)}</strong></p>${out ? `<pre>${escape(out)}</pre>` : ''}`;
  await noteRepo.create(
    job.ticketId,
    { content: `${header}\n\n${out}`, htmlContent: html, author: 'RMM', noteType: 'note' },
    'rmm',
  ).catch(() => {});
}

export interface RunScriptRequest {
  deviceId: number;
  /** Which linked RMM to use when a device has more than one external ref. */
  provider?: string;
  script: string;
  scriptName?: string;
  args?: string[];
  timeout?: number;
  ticketId?: number;
  scheduledFor?: Date;
}

function validateTimeout(timeout: number | undefined): void {
  if (timeout === undefined) return;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3_600) {
    throw new Error('timeout must be an integer between 1 and 3600 seconds');
  }
}

async function finishJob(
  jobId: number,
  status: 'success' | 'error',
  output: string,
  exitCode?: number,
  invocationId?: string,
) {
  const finished = await scriptJobRepo.markFinished(
    jobId,
    status,
    output.slice(0, MAX_STORED_OUTPUT),
    exitCode,
    invocationId,
  );
  if (finished.transitioned) await appendJobLog(finished.job);
  return finished.job;
}

async function persistRunnerResult(jobId: number, result: ScriptResult) {
  const terminal = terminalStatusForResult(result);
  if (terminal) {
    return finishJob(jobId, terminal, result.output ?? '', result.exitCode, result.invocationId);
  }
  const invocationId = result.invocationId?.trim();
  if (!invocationId) throw new Error('Runner returned a nonterminal result without an invocation id');
  return scriptJobRepo.markProgress(jobId, invocationId, (result.output ?? '').slice(0, MAX_STORED_OUTPUT));
}

/** Create a job and, unless scheduled for later, run it immediately. */
export async function runOrSchedule(req: RunScriptRequest, actorSub: string) {
  validateTimeout(req.timeout);
  if (!req.script?.trim()) throw new Error('script is required');
  if (req.scheduledFor && Number.isNaN(req.scheduledFor.getTime())) throw new Error('scheduledFor must be a valid date');
  const device = await prisma.device.findUnique({
    where: { id: req.deviceId },
    include: { externalRefs: { orderBy: { id: 'asc' } } },
  });
  if (!device) throw new Error(`Device ${req.deviceId} not found`);
  const runnableRefs = device.externalRefs.filter((ref) =>
    RUNNABLE_PROVIDERS.includes(ref.provider),
  );
  const requestedProvider = req.provider?.trim();
  const selected = requestedProvider
    ? runnableRefs.find((ref) => ref.provider === requestedProvider)
    : runnableRefs.find((ref) => ref.provider === device.externalProvider) ?? runnableRefs[0];
  const legacyMatchesRequest = !!requestedProvider
    && requestedProvider === device.externalProvider
    && !!device.externalId
    && RUNNABLE_PROVIDERS.includes(requestedProvider);
  if (requestedProvider && !selected && !legacyMatchesRequest) {
    throw new Error(`Device ${device.id} is not linked to RMM provider "${requestedProvider}"`);
  }
  const runner = selected?.provider
    ?? (requestedProvider && legacyMatchesRequest ? requestedProvider : device.externalProvider);
  const externalId = selected?.externalId
    ?? (runner === device.externalProvider ? device.externalId : null);
  if (!externalId || !runner || !RUNNABLE_PROVIDERS.includes(runner)) {
    throw new Error('Device is not linked to an RMM — scripts require a device synced from an RMM');
  }
  if (req.timeout !== undefined && runner !== 'tactical_rmm') {
    throw new Error(`timeout is not supported by ${runner}`);
  }

  const job = await scriptJobRepo.create(
    {
      deviceId: device.id,
      ticketId: req.ticketId,
      runner,
      externalDeviceId: externalId,
      scriptRef: req.script,
      scriptName: req.scriptName,
      args: req.args,
      timeoutSeconds: req.timeout,
      scheduledFor: req.scheduledFor,
    },
    actorSub
  );

  // Future-dated → leave queued for the scheduler.
  if (req.scheduledFor && req.scheduledFor.getTime() > Date.now()) {
    return job;
  }

  return execute(job.id);
}

/** Execute a queued job now. Used by both immediate runs and the scheduler. */
export async function execute(jobId: number) {
  // The queued -> running compare-and-set is the idempotency boundary. A losing
  // caller returns the current row and must never invoke the external runner.
  const claimed = await scriptJobRepo.claimQueued(jobId);
  if (!claimed) {
    const current = await scriptJobRepo.getById(jobId);
    if (!current) throw new Error(`Script job ${jobId} not found`);
    return current;
  }
  const job = claimed;

  const device = await prisma.device.findUnique({
    where: { id: job.deviceId },
    include: { externalRefs: true },
  });
  const ref = job.externalDeviceId
    ? undefined
    : device?.externalRefs.find((candidate) => candidate.provider === job.runner);
  // 2.1.0+ jobs pin their provider-specific target when queued. The fallback
  // keeps jobs created before that additive column was introduced runnable.
  const externalId = job.externalDeviceId ?? ref?.externalId
    ?? (device?.externalProvider === job.runner ? device.externalId : null);
  if (!device || !externalId) {
    return finishJob(jobId, 'error', 'Device has no external RMM id', 1);
  }

  try {
    const runner = createScriptRunner(job.runner);
    const result = await runner.run({
      deviceId: device.id,
      externalDeviceId: externalId,
      script: job.scriptRef,
      args: (job.args as string[] | null) ?? undefined,
      timeout: job.timeoutSeconds ?? undefined,
    });
    return persistRunnerResult(jobId, result);
  } catch (err) {
    return finishJob(jobId, 'error', (err as Error).message, 1);
  }
}

/** Poll a provider-acknowledged asynchronous job without ever re-executing it. */
export async function refresh(jobId: number) {
  const job = await scriptJobRepo.getById(jobId);
  if (!job) throw new Error(`Script job ${jobId} not found`);
  if (job.status !== 'running' || !job.invocationId) return job;

  const runner = createScriptRunner(job.runner);
  if (!runner.getResult) return job;
  const result = await runner.getResult(job.invocationId);
  return persistRunnerResult(job.id, {
    ...result,
    invocationId: result.invocationId || job.invocationId,
  });
}
