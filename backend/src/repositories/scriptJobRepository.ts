import { Prisma, ScriptJobStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';

export interface CreateScriptJobInput {
  deviceId: number;
  ticketId?: number;
  runner: string;
  externalDeviceId: string;
  scriptRef: string;
  scriptName?: string;
  args?: string[];
  timeoutSeconds?: number;
  scheduledFor?: Date;
  createdBy?: string;
}

export async function create(input: CreateScriptJobInput, actorSub: string) {
  const job = await prisma.scriptJob.create({
    data: {
      deviceId: input.deviceId,
      ticketId: input.ticketId,
      runner: input.runner,
      externalDeviceId: input.externalDeviceId,
      scriptRef: input.scriptRef,
      scriptName: input.scriptName,
      args: (input.args as Prisma.InputJsonValue) ?? undefined,
      timeoutSeconds: input.timeoutSeconds,
      scheduledFor: input.scheduledFor,
      createdBy: input.createdBy ?? actorSub,
      status: 'queued',
    },
  });

  await audit.record({
    entityType: 'script_job',
    entityId: job.id,
    action: 'create',
    changedBy: actorSub,
    newValue: {
      deviceId: job.deviceId,
      runner: job.runner,
      externalDeviceId: job.externalDeviceId,
      scriptRef: job.scriptRef,
      timeoutSeconds: job.timeoutSeconds,
      scheduledFor: job.scheduledFor,
    },
  });

  return job;
}

/**
 * Atomically claim one queued job. updateMany supplies the compare-and-set:
 * only the worker that changes queued -> running may call the external RMM.
 */
export async function claimQueued(id: number, now: Date = new Date()) {
  const claimed = await prisma.scriptJob.updateMany({
    where: {
      id,
      status: 'queued',
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    data: { status: 'running', startedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  return prisma.scriptJob.findUnique({ where: { id } });
}

async function currentOrThrow(id: number) {
  const job = await prisma.scriptJob.findUnique({ where: { id } });
  if (!job) throw new Error(`Script job ${id} not found`);
  return job;
}

/** Persist a provider acknowledgement that has not reached a terminal state. */
export async function markProgress(id: number, invocationId: string, output: string) {
  await prisma.scriptJob.updateMany({
    where: { id, status: 'running' },
    data: {
      invocationId: invocationId.slice(0, 512),
      output,
    },
  });
  return currentOrThrow(id);
}

export async function markFinished(
  id: number,
  status: Extract<ScriptJobStatus, 'success' | 'error'>,
  output: string,
  exitCode?: number,
  invocationId?: string,
) {
  const updated = await prisma.scriptJob.updateMany({
    where: { id, status: 'running' },
    data: {
      status,
      output,
      exitCode,
      invocationId: invocationId?.slice(0, 512),
      completedAt: new Date(),
    },
  });
  return { job: await currentOrThrow(id), transitioned: updated.count === 1 };
}

export async function getById(id: number) {
  return prisma.scriptJob.findUnique({ where: { id } });
}

export async function listForDevice(deviceId: number, limit = 50) {
  return prisma.scriptJob.findMany({
    where: { deviceId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function listForTicket(ticketId: number, limit = 50) {
  return prisma.scriptJob.findMany({
    where: { ticketId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/** Jobs that are queued and due to run (scheduledFor <= now, or immediate). */
export async function dueJobs(now: Date = new Date()) {
  return prisma.scriptJob.findMany({
    where: {
      status: 'queued',
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
    },
    orderBy: { createdAt: 'asc' },
    take: 25,
  });
}

/** Datto async jobs can be refreshed by UID; other runners expose no poll API. */
export async function runningJobs(limit = 25) {
  return prisma.scriptJob.findMany({
    where: { status: 'running', runner: 'datto_rmm', invocationId: { not: null } },
    orderBy: { startedAt: 'asc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
}
