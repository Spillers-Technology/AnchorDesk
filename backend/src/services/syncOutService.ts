/**
 * Create a local ticket in an external PSA ("Sync to external PSA" on New
 * ticket, "Send to PSA" on an existing one). The destination is a two-way sync
 * job: it names the account, and the project (Jira) or board (ConnectWise) to
 * create in. See docs/roadmap-sync-scope.md §6.
 *
 * Order matters. The local ticket already exists when this runs, so a remote
 * failure never loses work — the ticket just stays local, and the error says
 * why. Once the remote exists the ticket is linked, owned by the job, and
 * pinned (a person chose to send it, so the job's filter doesn't get a vote).
 *
 * After creation the ticket adopts the PSA's status and priority, exactly as
 * an imported ticket speaks the PSA's vocabulary. Pushing AnchorDesk's own
 * names ("New") into a remote workflow ("To Do") would fail and leave a
 * brand-new ticket flagged as a sync error.
 */

import { ProviderType } from '@prisma/client';
import { prisma } from '../db/prisma';
import { createTicketProvider, resolveCredentials } from '../providers/ticketProviderFactory';
import * as ticketRepo from '../repositories/ticketRepository';
import * as noteRepo from '../repositories/noteRepository';
import * as audit from '../repositories/auditRepository';
import { fingerprint } from './twoWaySync';
import { syncAccountKeyForProvider, withSyncAccountLock } from './syncAccountLock';

export class SyncOutError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 502) {
    super(message);
  }
}

const CREATABLE_TYPES: ProviderType[] = ['jira', 'connectwise'];

export interface Destination {
  jobId: number;
  name: string;
  type: ProviderType;
  /** Where the ticket lands, e.g. "Jira · project HELP" or "ConnectWise · board Support". */
  target: string;
  /** Why this job can't create tickets right now, or null. */
  blocker: string | null;
}

/**
 * Enabled two-way jobs, each with what it would create into and whether it
 * can. Decided from configuration alone: building a provider needs live
 * credentials, and listing destinations must not.
 */
export async function listDestinations(): Promise<Destination[]> {
  const jobs = await prisma.syncProvider.findMany({
    where: { enabled: true, type: { in: CREATABLE_TYPES } },
    include: { connection: { select: { name: true, enabled: true } } },
    orderBy: { name: 'asc' },
  });
  return jobs.map((job) => {
    const cfg = (job.config ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    let blocker: string | null = null;
    let target: string;
    if (job.type === 'jira') {
      const project = str(cfg.projectKey);
      target = project ? `Jira · project ${project}` : 'Jira';
      if (!job.connectionId || !job.connection) blocker = 'this job has no Jira account selected';
      else if (!job.connection.enabled) blocker = `the Jira account “${job.connection.name}” is disabled`;
      else if (!project) blocker = 'set a project key on this job to create issues from AnchorDesk';
    } else {
      const board = str(cfg.board);
      target = board ? `ConnectWise · board ${board}` : 'ConnectWise';
      if (!board) blocker = 'this job has no board';
    }
    return { jobId: job.id, name: job.name, type: job.type, target, blocker };
  });
}

export interface SendResult {
  ticketId: number;
  externalId: string;
  provider: string;
  jobName: string;
  /** Anything that didn't make it across, in words (e.g. the assignee). */
  warnings: string[];
}

export async function sendToPsa(ticketId: number, jobId: number, actor: string): Promise<SendResult> {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new SyncOutError('ticket not found', 404);
  // Only a PSA link counts as "already sent". An email ticket's externalId is
  // its root Message-ID, which replies thread on through the root *note*
  // (imapService); the ticket keeps its email provenance in `source`.
  if (ticket.externalId && ticket.externalProvider && (CREATABLE_TYPES as string[]).includes(ticket.externalProvider)) {
    throw new SyncOutError(`this ticket is already linked to ${ticket.externalProvider} ${ticket.externalId}`, 409);
  }
  if (ticket.mergedIntoId) throw new SyncOutError('a merged ticket cannot be sent to a PSA', 409);

  const job = await prisma.syncProvider.findUnique({ where: { id: jobId } });
  if (!job) throw new SyncOutError('sync job not found', 404);
  if (!job.enabled) throw new SyncOutError(`sync job “${job.name}” is disabled`, 409);
  if (!CREATABLE_TYPES.includes(job.type)) throw new SyncOutError(`${job.type} jobs cannot create tickets`, 409);

  let resolved: Awaited<ReturnType<typeof resolveCredentials>>;
  try {
    resolved = await resolveCredentials(job.type, job.connectionId ?? null);
  } catch (err) {
    throw new SyncOutError((err as Error).message, 409);
  }
  const cfg = (job.config ?? {}) as Record<string, unknown>;
  const provider = createTicketProvider(job.type, cfg, resolved.credentials);
  const blocker = provider.createBlocker?.() ?? null;
  if (blocker) throw new SyncOutError(blocker, 409);
  if (!provider.pushTicket) throw new SyncOutError(`${provider.name} cannot create tickets`, 409);

  const accountKey = syncAccountKeyForProvider(job.type, resolved.connectionId, job.id);
  return withSyncAccountLock(accountKey, async () => {
    let externalId: string;
    try {
      externalId = await provider.pushTicket!({
        title: ticket.title,
        description: ticket.description ?? undefined,
        companyName: ticket.companyName ?? undefined,
      });
    } catch (err) {
      throw new SyncOutError(`${job.name}: ${(err as Error).message}`, 502);
    }

    // Link first, in one write: from here on the remote exists, and the link
    // is what stops a retry from creating a duplicate.
    try {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: {
          externalId,
          externalProvider: provider.name,
          syncConnectionId: resolved.connectionId,
          syncJobId: job.id,
          syncScopePinned: true,
          syncState: 'synced',
        },
      });
    } catch (err) {
      // The remote ticket exists but couldn't be linked. Say exactly which one,
      // so nobody creates a second copy trying again.
      throw new SyncOutError(
        `${provider.name} created ${externalId}, but AnchorDesk could not link it to this ticket: ${(err as Error).message}. ` +
          `Link ${externalId} by hand rather than sending again.`,
        502,
      );
    }

    const warnings: string[] = [];

    // Adopt the PSA's vocabulary and record the baseline for two-way sync.
    const remote = provider.getTicket ? await provider.getTicket(externalId).catch(() => null) : null;
    if (remote) {
      await ticketRepo.update(
        ticketId,
        { status: remote.status, priority: remote.priority || undefined },
        actor,
        {
          origin: 'remote',
          syncResult: { state: 'synced', remoteHash: fingerprint(remote), remoteUpdatedAt: remote.updatedAt ?? null, syncedAt: new Date() },
        },
      );
    } else {
      warnings.push(`couldn't read ${externalId} back; the next sync run records its baseline`);
      await prisma.ticket.update({ where: { id: ticketId }, data: { remoteHash: null } });
    }

    // The assignee is best effort: a local display name may not map to a
    // remote account (ConnectWise wants a member identifier).
    if (ticket.assignee?.trim() && provider.updateTicket && provider.writableFields?.includes('assignee')) {
      try {
        await provider.updateTicket(externalId, { assignee: ticket.assignee });
      } catch (err) {
        warnings.push(`assignee “${ticket.assignee}” wasn't set in ${provider.name}: ${(err as Error).message}`);
      }
    }

    await audit.record({
      entityType: 'ticket',
      entityId: ticketId,
      action: 'sync',
      changedBy: actor,
      oldValue: { externalId: null },
      newValue: { externalId, externalProvider: provider.name, syncJob: job.name },
    });
    await noteRepo.create(
      ticketId,
      {
        content:
          `Created in ${provider.name} as ${externalId} through sync job “${job.name}”.` +
          (warnings.length ? `\n\nNot carried over: ${warnings.join('; ')}.` : ''),
        author: 'AnchorDesk sync',
        noteType: 'internal',
        visibility: 'internal',
        via: 'sync',
      },
      'system',
    );

    return { ticketId, externalId, provider: provider.name, jobName: job.name, warnings };
  });
}
