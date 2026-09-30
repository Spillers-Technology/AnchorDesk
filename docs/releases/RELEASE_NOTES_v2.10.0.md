# AnchorDesk 2.10.0 — Sounding Line (minor)

A sounding line is how you learn how much water is under you. This release
answers the question sync never did — **what decides how much syncs to a
PSA** — and gives the admin console the same redesign the rest of the product
got.

## Sync scope: a definite answer to "how much"

The two-way diff was careful; what went *into* it was not. Technicians were
matched by display name, ConnectWise downloaded whole boards and threw most of
them away, nobody could see a job's size before enabling it, and a ticket that
drifted out of a job's filter was silently followed forever. Now:

- **Tickets belong to one job.** Each synced ticket records the job that
  imported it. Overlapping jobs on one account no longer both reconcile it.
  Existing tickets are assigned at first start wherever the owner is provable
  (one job on that account); elsewhere the first job whose filter a ticket
  matches adopts it.
- **Filter technicians by ID.** Pick people straight from Jira or ConnectWise
  in the job editor. They're matched by Jira account ID, or by ConnectWise
  owner *and* every assigned resource — which also fixes the old name filter,
  which never matched a ConnectWise ticket with more than one resource.
- **The remote does the filtering.** ConnectWise now sends status, priority,
  company and technicians in its query, as Jira already did.
- **Preview before you enable.** *Preview first run* shows how many tickets a
  job would import (approximate on Jira; an upper bound when a clause can only
  be checked after fetching).
- **Leaving scope stops sync, visibly.** When a ticket no longer matches its
  job's filter, the change that took it out lands first — a ticket closed in
  the PSA arrives closed; reassigned, it shows who — then it stops syncing.
  The local copy stays, and the ticket says why: *"it's assigned to “Sam
  Rivera”; this job only syncs Jess Spillers, Priya Shah."* It resumes by
  itself if it comes back into scope. A conflict on that last sync is settled
  first; a ticket that can't be read back is reported, never silently dropped.
- **Bypass requests.** Anyone who can edit tickets can ask for a stopped
  ticket to keep syncing, with a reason. Any admin approves or rejects — from
  the ticket or the new queue in Admin → Ticket sync — and both sides are
  notified. Approved tickets keep syncing regardless of the filter until an
  admin removes the bypass.
- **Create tickets in the PSA.** New ticket has a first-class **Sync to
  external PSA** choice, and any local ticket — email ones included — has
  **Send to PSA**. Jira creates in the job's project (issue type configurable);
  ConnectWise on the job's board, matching the company by exact name or a
  default you set. The ticket is created in AnchorDesk first, so a PSA refusal
  never loses it, and it says what didn't carry over.

History is never limited: AnchorDesk keeps everything it syncs.

## An admin console that tells you what's wrong

- **Overview** scores *setup readiness* from your real settings — outbound
  mail, whether mailboxes are polling (and why one isn't), a catch-all SLA,
  required MFA, attachment storage — each with a link to the fix.
- **Find a setting** searches every section by what you'd type ("smtp",
  "sso", "imap"). On phones, one breadcrumb opens the sections in a sheet.
- **Every panel** shares one design: clear headers and status, empty states
  that say what to do next, confirmations that say what's kept, and results
  that appear as a notification instead of a banner you have to dismiss.
- **Fixes:** password reset used a browser prompt; seven kinds of record could
  be deleted with a single click; several actions failed silently; secret
  fields hid whether a secret was already set; the last admin could be picked
  for demotion before the server refused it.

## Upgrading

Back up first ([backup-restore.md](https://github.com/Spillers-Technology/AnchorDesk/blob/main/docs/backup-restore.md)), then pull and
restart. The first start applies migration `1_sync_scope` — additive only:
new ticket columns, a new sync state, a run counter, and the bypass-request
table — and then assigns existing synced tickets to their jobs.

- **From 2.9.0:** pull and restart.
- **From 2.8.x:** pull and restart; the 2.9.0 baseline adoption runs first,
  then `1_sync_scope`. Proven in CI against a real 2.8 install.
- **Rolling back** to 2.9.0 by swapping the image is **not** safe after the
  first 2.10.0 start: 2.9.0 cannot read a ticket whose sync stopped. Roll back
  by restoring the pre-upgrade backup.

## Known issues and limits

- **ConnectWise is still alpha.** Its new scope, member search, create and
  count calls are tested against the client library, not a live tenant.
- A ticket moved to another ConnectWise board, or out of a Jira job's project,
  is noticed on the job's next full scan (its first run, or the first run after
  an edit), not on routine incremental runs.
- Carried forward: the example Kubernetes manifests store local attachments
  without a volume (use S3 or mount `/backend/data/attachments`); the
  Tactical, NinjaOne and Datto admin cards can show "configured" before their
  secret is saved (#36).

Design and decisions: [docs/roadmap-sync-scope.md](https://github.com/Spillers-Technology/AnchorDesk/blob/main/docs/roadmap-sync-scope.md).
