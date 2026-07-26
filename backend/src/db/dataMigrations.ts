/**
 * Idempotent boot-time data migrations — the data counterpart to the schema
 * `prisma db push` the containers run before start. Each fix is a no-op once
 * applied, so running on every boot is safe and old instances upgrade just by
 * pulling a newer image. Status/priority fixes only touch LOCAL tickets:
 * external providers own their vocabularies.
 */
import { FastifyBaseLogger } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '../services/ticketVocab';

export async function runDataMigrations(log: FastifyBaseLogger): Promise<void> {
  let fixed = 0;

  // 2.4.0 — the MCP tools historically taught agents a fictional "open"
  // status and a numeric priority scale; the backend accepted any casing.
  // Canonicalize local tickets so they land back in board columns, status
  // filters, and SLA policy matches.
  for (const status of TICKET_STATUSES) {
    const r = await prisma.$executeRaw`
      UPDATE tickets SET status = ${status}
      WHERE external_provider IS NULL AND status <> ${status} AND lower(status) = ${status.toLowerCase()}`;
    fixed += r;
  }
  fixed += await prisma.$executeRaw`
    UPDATE tickets SET status = 'New'
    WHERE external_provider IS NULL AND lower(status) = 'open'`;

  for (const priority of TICKET_PRIORITIES) {
    const r = await prisma.$executeRaw`
      UPDATE tickets SET priority = ${priority}
      WHERE external_provider IS NULL AND priority <> ${priority} AND lower(priority) = ${priority.toLowerCase()}`;
    fixed += r;
  }
  // Legacy numeric priorities (pre-1.3 scale; '3' was the old MCP default).
  const numericMap: [string, string][] = [
    ['1', 'Critical'],
    ['2', 'High'],
    ['3', 'Medium'],
    ['4', 'Low'],
    ['5', 'Low'],
    ['6', 'Low'],
  ];
  for (const [digit, priority] of numericMap) {
    fixed += await prisma.$executeRaw`
      UPDATE tickets SET priority = ${priority}
      WHERE external_provider IS NULL AND priority = ${digit}`;
  }

  if (fixed > 0) log.info(`Data migrations normalized ${fixed} ticket status/priority values.`);

  await classifyLegacyEmailCorrespondence(log);
  await adoptLegacyCredentialsAsConnections(log);
  await purgeIllegalConnectwiseConnections(log);
  await disableUnscopedConnectwiseJobs(log);
}

/**
 * 2.7 — before notes had an explicit portal audience, `note_type = 'email'`
 * was the representation for requester-visible correspondence. Classify those
 * rows once so every portal read can fail closed on the audience fields alone.
 *
 * A single data-modifying CTE classifies notes and attachments atomically. The
 * portal also requires a linked note to be explicitly public before serving
 * its bytes, which keeps mixed-version rollouts fail closed.
 */
export async function classifyLegacyEmailCorrespondence(
  log: FastifyBaseLogger,
): Promise<void> {
  const [result] = await prisma.$queryRaw<
    Array<{ attachments: number; notes: number }>
  >`
    WITH legacy_email_notes AS MATERIALIZED (
      SELECT id
      FROM notes
      WHERE note_type = 'email'
        AND via IS NULL
    ),
    updated_attachments AS (
      UPDATE attachments AS attachment
      SET portal_visible = true
      WHERE attachment.note_id IN (
        SELECT id FROM legacy_email_notes
      )
        AND attachment.portal_visible = false
      RETURNING attachment.id
    ),
    updated_notes AS (
      UPDATE notes AS note
      SET visibility = 'public',
          via = 'email'
      WHERE note.id IN (
        SELECT id FROM legacy_email_notes
      )
      RETURNING note.id
    )
    SELECT
      (SELECT count(*)::int FROM updated_attachments) AS attachments,
      (SELECT count(*)::int FROM updated_notes) AS notes
  `;
  const attachments = result?.attachments ?? 0;
  const notes = result?.notes ?? 0;

  if (notes > 0 || attachments > 0) {
    log.info(
      `Data migrations classified ${notes} legacy email note(s) and ` +
        `${attachments} attachment(s) as requester-visible.`,
    );
  }
}

/**
 * 2.5 — credentials moved from a single `settings` row per provider type onto
 * first-class `Connection` records, so one install can sync several Jira
 * tenants.
 *
 * Jira only: ConnectWiseProvider still reads the process-global CW client
 * (see connectionRepository.ts — `SUPPORTED_CONNECTION_TYPES = ['jira']`), so
 * a ConnectWise `Connection` row would record provenance that never actually
 * controlled the request. This lifts an existing install's Jira credentials
 * into a default connection and attaches existing sync jobs to it, so
 * upgrading is still pull-and-restart. Idempotent: it only acts when there
 * are usable credentials and no connection yet.
 */
async function adoptLegacyCredentialsAsConnections(log: FastifyBaseLogger): Promise<void> {
  const type = 'jira';
  const required = ['baseUrl', 'email', 'apiToken'];
  const existing = await prisma.connection.findMany({ where: { type } });

  // Already adopted. Re-run the attachment step anyway: if a previous boot
  // created the connection but died before the bulk updates, skipping here
  // would strand those jobs/tickets unattached forever.
  if (existing.length === 1) {
    await attachUnlinked(type, existing[0].id, log);
    return;
  }
  // Several accounts exist — attaching by type would be a guess.
  if (existing.length > 1) return;

  const row = await prisma.setting.findUnique({ where: { key: 'jira' } });
  const cfg = (row?.value ?? {}) as Record<string, unknown>;

  // Only adopt credentials that could actually authenticate. Adopting a
  // half-filled settings row would manufacture a connection that always fails
  // and looks like a real one.
  const usable = required.every((f) => String(cfg[f] ?? '').trim().length > 0);
  if (!usable) return;

  const scope = legacyJiraScope(cfg);

  // One transaction: a connection without its attachments is a half-migrated
  // state that the guard above would otherwise treat as complete.
  const connection = await prisma.$transaction(async (tx) => {
    const created = await tx.connection.create({
      data: {
        name: 'Jira (default)',
        type,
        config: Object.fromEntries(required.map((f) => [f, String(cfg[f])])) as Prisma.InputJsonObject,
        enabled: true,
      },
    });
    await attachJobsAndTickets(tx, type, created.id, scope);
    return created;
  });

  log.info(
    `Adopted legacy Jira credentials as connection "${connection.name}". ` +
      'Note: existing jobs and tickets are attached to it on the assumption ' +
      'that this install only ever synced one Jira account. If the credentials ' +
      'were repointed at a different tenant historically, reassign the ' +
      'affected tickets.'
  );
}

/** The legacy global JIRA_PROJECT_KEY/JIRA_JQL scope, if any was ever set.
 *  `settingsService`/`config.jira` no longer expose these — project/JQL scope
 *  is a per-job setting now (routes/sync.ts) — but a pre-2.5 settings row can
 *  still carry them, and a job created before per-job scope existed has no
 *  other source for what it used to sync. */
export function legacyJiraScope(cfg: Record<string, unknown>): { projectKey?: string; jql?: string } {
  const out: { projectKey?: string; jql?: string } = {};
  if (typeof cfg.projectKey === 'string' && cfg.projectKey.trim()) out.projectKey = cfg.projectKey.trim();
  if (typeof cfg.jql === 'string' && cfg.jql.trim()) out.jql = cfg.jql.trim();
  return out;
}

/**
 * Attach unlinked jobs/tickets of this type to a connection. For Jira, a job
 * that has neither its own `projectKey` nor `jql` gets the legacy global
 * scope backfilled onto it in the same write.
 *
 * This matters because `JiraProvider` only inherits legacy scope for jobs
 * with NO connection (`ticketProviderFactory.ts`'s `inheritLegacyScope`
 * predicate before this fix — see JiraProvider.ts) — the instant a job is
 * linked here, it would otherwise silently lose its project/JQL restriction
 * and widen to every visible project. Idempotent: a job that already has its
 * own scope, or was already linked, is left alone.
 */
async function attachJobsAndTickets(
  tx: Prisma.TransactionClient,
  type: 'jira' | 'connectwise',
  connectionId: number,
  scope: { projectKey?: string; jql?: string }
): Promise<{ jobs: number; tickets: number }> {
  const unlinkedJobs = await tx.syncProvider.findMany({ where: { type, connectionId: null } });
  for (const job of unlinkedJobs) {
    const cfg = (job.config ?? {}) as Record<string, unknown>;
    const needsScope = type === 'jira' && !cfg.projectKey && !cfg.jql && (scope.projectKey || scope.jql);
    await tx.syncProvider.update({
      where: { id: job.id },
      data: {
        connectionId,
        config: needsScope ? ({ ...cfg, ...scope } as Prisma.InputJsonValue) : undefined,
      },
    });
  }
  const tickets = await tx.ticket.updateMany({
    where: { externalProvider: type, syncConnectionId: null },
    data: { syncConnectionId: connectionId },
  });
  return { jobs: unlinkedJobs.length, tickets: tickets.count };
}

/** Attach any jobs/tickets a previous partial run left unlinked. Idempotent. */
async function attachUnlinked(type: 'jira' | 'connectwise', connectionId: number, log: FastifyBaseLogger): Promise<void> {
  let scope: { projectKey?: string; jql?: string } = {};
  if (type === 'jira') {
    const row = await prisma.setting.findUnique({ where: { key: 'jira' } });
    scope = legacyJiraScope((row?.value ?? {}) as Record<string, unknown>);
  }
  const { jobs, tickets } = await prisma.$transaction((tx) => attachJobsAndTickets(tx, type, connectionId, scope));
  if (jobs || tickets) {
    log.info(`Attached ${jobs} ${type} sync job(s) and ${tickets} ticket(s) to their connection.`);
  }
}

/**
 * Defense in depth: a ConnectWise `Connection` should never exist — CW jobs
 * intentionally cannot be linked to one (see connectionRepository.ts) because
 * ConnectWiseProvider ignores the credentials it would carry and always uses
 * the process-global client. If one exists anyway (e.g. created by an older
 * build of this migration before this guard), unlink any job pointing at it
 * and delete it, rather than leaving a connection whose recorded provenance
 * never actually controlled the request it's credited with.
 */
async function purgeIllegalConnectwiseConnections(log: FastifyBaseLogger): Promise<void> {
  const illegal = await prisma.connection.findMany({ where: { type: 'connectwise' } });
  if (illegal.length === 0) return;

  for (const connection of illegal) {
    await prisma.$transaction(async (tx) => {
      await tx.syncProvider.updateMany({ where: { connectionId: connection.id }, data: { connectionId: null } });
      // The early broken migration also stamped this connection id onto
      // ConnectWise tickets. Ticket.syncConnectionId is not a foreign key, so
      // deleting the Connection without clearing those rows would leave a
      // dangling id that makes fail-closed credential resolution skip every
      // future reconcile for the affected tickets.
      await tx.ticket.updateMany({ where: { syncConnectionId: connection.id }, data: { syncConnectionId: null } });
      await tx.connection.delete({ where: { id: connection.id } });
    });
  }
  log.warn(
    `Removed ${illegal.length} ConnectWise connection(s) — ConnectWise cannot be a Connection yet ` +
      '(its client is still process-global); any sync job that was linked to one now uses the ' +
      'single global ConnectWise account again.'
  );
}

/**
 * Older builds silently substituted a tenant-specific board when a ConnectWise
 * job had no `config.board`. That hidden scope cannot be reconstructed safely
 * in a general product build. Disable those jobs on upgrade so an admin must
 * choose the exact board before another scheduled or manual request can run;
 * never widen them to every board.
 */
async function disableUnscopedConnectwiseJobs(
  log: FastifyBaseLogger
): Promise<void> {
  const disabled = await prisma.$executeRaw`
    UPDATE sync_providers
    SET enabled = false,
        last_synced_at = NULL,
        config_revision = config_revision + 1
    WHERE type = 'connectwise'
      AND enabled = true
      AND NULLIF(btrim(config ->> 'board'), '') IS NULL
  `;
  if (disabled > 0) {
    log.warn(
      `Disabled ${disabled} ConnectWise sync job(s) with no explicit board. ` +
        'Choose the intended board in Admin -> Ticket Sync before re-enabling.'
    );
  }
}
