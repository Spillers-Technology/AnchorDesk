/**
 * Idempotent boot-time data migrations — the data counterpart to the schema
 * `prisma db push` the containers run before start. Each fix is a no-op once
 * applied, so running on every boot is safe and old instances upgrade just by
 * pulling a newer image. Only LOCAL tickets are touched: external providers
 * own their status/priority vocabularies.
 */
import { FastifyBaseLogger } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '../services/ticketVocab';

/**
 * 2.7 — reconstruct the metric spine from durable audit rows. source_audit_id +
 * kind is the same identity used by live delivery, so this safely repairs a
 * subscriber write lost to process shutdown without duplicating facts that did
 * commit. Reconstructed rows are always labelled actor='backfill'.
 *
 * One status mutation produces exactly one classification: resolved, reopened,
 * or status_changed. Merge is kept distinct, and only the merge source's full
 * audit row qualifies.
 */
export const TICKET_EVENT_BACKFILL_SQL = `
  WITH ticket_audits AS (
    SELECT audit.id AS audit_id,
           audit.entity_id AS ticket_id,
           audit.action::text AS action,
           audit.old_value,
           audit.new_value,
           CASE
             WHEN audit.action::text = 'create'
               THEN coalesce(
                 nullif(audit.new_value ->> 'createdAt', '')::timestamptz,
                 audit.occurred_at
               )
             WHEN audit.action::text = 'merge'
               THEN coalesce(
                 nullif(audit.new_value ->> 'mergedAt', '')::timestamptz,
                 nullif(audit.new_value ->> 'updatedAt', '')::timestamptz,
                 audit.occurred_at
               )
             ELSE coalesce(
               nullif(audit.new_value ->> 'updatedAt', '')::timestamptz,
               audit.occurred_at
             )
           END AS occurred_at,
           audit.old_value ->> 'status' AS old_status,
           CASE
             WHEN audit.action::text = 'delete' THEN 'Deleted'
             ELSE audit.new_value ->> 'status'
           END AS new_status,
           nullif(coalesce(audit.new_value ->> 'companyId', audit.old_value ->> 'companyId'), '')::int AS company_id,
           nullif(coalesce(audit.new_value ->> 'teamId', audit.old_value ->> 'teamId'), '')::int AS team_id,
           nullif(coalesce(audit.new_value ->> 'assigneeId', audit.old_value ->> 'assigneeId'), '')::int AS assignee_id,
           coalesce(audit.new_value ->> 'priority', audit.old_value ->> 'priority') AS priority
    FROM audit_log AS audit
    WHERE audit.entity_type = 'ticket'
  ),
  created AS (
    SELECT audit_id AS source_audit_id,
           ticket_id,
           'created'::text AS kind,
           NULL::text AS from_value,
           coalesce(new_status, 'New')::text AS to_value,
           company_id,
           team_id,
           assignee_id,
           priority,
           occurred_at
    FROM ticket_audits
    WHERE action = 'create'
  ),
  status_transitions AS (
    SELECT audit_id AS source_audit_id,
           ticket_id,
           CASE
             WHEN old_status NOT IN ('Resolved', 'Closed')
              AND new_status IN ('Resolved', 'Closed') THEN 'resolved'
             WHEN old_status IN ('Resolved', 'Closed')
              AND new_status NOT IN ('Resolved', 'Closed', 'Deleted') THEN 'reopened'
             ELSE 'status_changed'
           END::text AS kind,
           old_status::text AS from_value,
           new_status::text AS to_value,
           company_id,
           team_id,
           assignee_id,
           priority,
           occurred_at
    FROM ticket_audits
    WHERE action IN ('update', 'unmerge', 'delete')
      AND old_status IS NOT NULL
      AND new_status IS NOT NULL
      AND old_status IS DISTINCT FROM new_status
  ),
  assignments AS (
    SELECT audit_id AS source_audit_id,
           ticket_id,
           'assigned'::text AS kind,
           concat(
             'a:', coalesce(old_value ->> 'assigneeId', ''),
             ';t:', coalesce(old_value ->> 'teamId', '')
           )::text AS from_value,
           concat(
             'a:', coalesce(new_value ->> 'assigneeId', ''),
             ';t:', coalesce(new_value ->> 'teamId', '')
           )::text AS to_value,
           company_id,
           team_id,
           assignee_id,
           priority,
           occurred_at
    FROM ticket_audits
    WHERE action = 'update'
      AND old_value ? 'status'
      AND new_value ? 'status'
      AND (
        old_value ->> 'assigneeId' IS DISTINCT FROM new_value ->> 'assigneeId'
        OR old_value ->> 'assignee' IS DISTINCT FROM new_value ->> 'assignee'
        OR old_value ->> 'teamId' IS DISTINCT FROM new_value ->> 'teamId'
      )
  ),
  context_changes AS (
    SELECT audit_id AS source_audit_id,
           ticket_id,
           'context_changed'::text AS kind,
           NULL::text AS from_value,
           NULL::text AS to_value,
           company_id,
           team_id,
           assignee_id,
           priority,
           occurred_at
    FROM ticket_audits
    WHERE action = 'update'
      AND old_value ? 'status'
      AND new_value ? 'status'
      AND (
        old_value ->> 'companyId' IS DISTINCT FROM new_value ->> 'companyId'
        OR old_value ->> 'priority' IS DISTINCT FROM new_value ->> 'priority'
      )
  ),
  merges AS (
    SELECT audit_id AS source_audit_id,
           ticket_id,
           'merged'::text AS kind,
           old_status::text AS from_value,
           new_value ->> 'mergedIntoId' AS to_value,
           company_id,
           team_id,
           assignee_id,
           priority,
           occurred_at
    FROM ticket_audits
    WHERE action = 'merge'
      AND new_value ? 'status'
      AND nullif(new_value ->> 'mergedIntoId', '') IS NOT NULL
  ),
  outbound_emails AS (
    SELECT audit.id AS source_audit_id,
           nullif(audit.new_value ->> 'ticketId', '')::int AS ticket_id,
           coalesce(
             nullif(audit.new_value ->> 'createdAt', '')::timestamptz,
             audit.occurred_at
           ) AS occurred_at,
           row_number() OVER (
             PARTITION BY nullif(audit.new_value ->> 'ticketId', '')::int
             ORDER BY coalesce(
               nullif(audit.new_value ->> 'createdAt', '')::timestamptz,
               audit.occurred_at
             ), audit.id
           ) AS response_number
    FROM audit_log AS audit
    WHERE audit.entity_type = 'note'
      AND audit.action::text = 'create'
      AND audit.new_value ->> 'noteType' = 'email'
      AND audit.new_value ->> 'direction' = 'outbound'
      AND nullif(audit.new_value ->> 'ticketId', '') IS NOT NULL
  ),
  first_responses AS (
    SELECT email.source_audit_id,
           email.ticket_id,
           'first_response'::text AS kind,
           NULL::text AS from_value,
           'responded'::text AS to_value,
           context.company_id,
           context.team_id,
           context.assignee_id,
           context.priority,
           email.occurred_at
    FROM outbound_emails AS email
    LEFT JOIN LATERAL (
      SELECT ticket.company_id,
             ticket.team_id,
             ticket.assignee_id,
             ticket.priority
      FROM ticket_audits AS ticket
      WHERE ticket.ticket_id = email.ticket_id
        AND ticket.occurred_at <= email.occurred_at
      ORDER BY ticket.occurred_at DESC, ticket.audit_id DESC
      LIMIT 1
    ) AS context ON true
    WHERE email.response_number = 1
  ),
  candidates AS (
    SELECT * FROM created
    UNION ALL SELECT * FROM status_transitions
    UNION ALL SELECT * FROM assignments
    UNION ALL SELECT * FROM context_changes
    UNION ALL SELECT * FROM merges
    UNION ALL SELECT * FROM first_responses
  )
  INSERT INTO ticket_events (
    ticket_id,
    kind,
    from_value,
    to_value,
    actor,
    company_id,
    team_id,
    assignee_id,
    priority,
    occurred_at,
    source_audit_id
  )
  SELECT ticket_id,
         kind,
         left(from_value, 100),
         left(to_value, 100),
         'backfill',
         company_id,
         team_id,
         assignee_id,
         left(priority, 50),
         occurred_at,
         source_audit_id
  FROM candidates
  ON CONFLICT DO NOTHING
`;

export async function backfillTicketEvents(): Promise<number> {
  return prisma.$executeRawUnsafe(TICKET_EVENT_BACKFILL_SQL);
}

export async function backfillWorkedAt(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE notes
    SET worked_at = coalesce(time_start, created_at)
    WHERE note_type = 'time_entry'
      AND worked_at IS NULL
  `;
}

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

  const [workedAtRows, eventRows] = await Promise.all([
    backfillWorkedAt(),
    backfillTicketEvents(),
  ]);
  if (workedAtRows > 0) {
    log.info(`Data migrations recorded worked_at for ${workedAtRows} legacy time entr${workedAtRows === 1 ? 'y' : 'ies'}.`);
  }
  if (eventRows > 0) {
    log.info(`Data migrations reconstructed ${eventRows} ticket event fact(s) from audit_log.`);
  }

  await adoptLegacyCredentialsAsConnections(log);
  await purgeIllegalConnectwiseConnections(log);
  await disableUnscopedConnectwiseJobs(log);
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
