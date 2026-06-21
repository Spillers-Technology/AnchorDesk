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
import * as scriptJobRepo from '../repositories/scriptJobRepository';
import * as noteRepo from '../repositories/noteRepository';

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
  script: string;
  scriptName?: string;
  args?: string[];
  timeout?: number;
  ticketId?: number;
  scheduledFor?: Date;
}

/** Create a job and, unless scheduled for later, run it immediately. */
export async function runOrSchedule(req: RunScriptRequest, actorSub: string) {
  const device = await prisma.device.findUnique({ where: { id: req.deviceId } });
  if (!device) throw new Error(`Device ${req.deviceId} not found`);
  if (!device.externalId || !device.externalProvider) {
    throw new Error('Device is not linked to an RMM — scripts require a device synced from an RMM');
  }

  const job = await scriptJobRepo.create(
    {
      deviceId: device.id,
      ticketId: req.ticketId,
      runner: device.externalProvider,
      scriptRef: req.script,
      scriptName: req.scriptName,
      args: req.args,
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
  const job = await scriptJobRepo.getById(jobId);
  if (!job) throw new Error(`Script job ${jobId} not found`);

  const device = await prisma.device.findUnique({ where: { id: job.deviceId } });
  if (!device?.externalId) {
    return scriptJobRepo.markFinished(jobId, 'error', 'Device has no external RMM id', 1);
  }

  await scriptJobRepo.markRunning(jobId);

  try {
    const runner = createScriptRunner(job.runner);
    const result = await runner.run({
      deviceId: device.id,
      externalDeviceId: device.externalId,
      script: job.scriptRef,
      args: (job.args as string[] | null) ?? undefined,
    });
    const finished = await scriptJobRepo.markFinished(
      jobId,
      result.status === 'error' ? 'error' : 'success',
      result.output ?? '',
      result.exitCode
    );
    await appendJobLog(finished);
    return finished;
  } catch (err) {
    const finished = await scriptJobRepo.markFinished(jobId, 'error', (err as Error).message, 1);
    await appendJobLog(finished);
    return finished;
  }
}
