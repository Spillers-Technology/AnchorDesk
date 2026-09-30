# Sync scope — what decides how much syncs

Status: implemented on `feat/sync-scope` (stacked on the admin console redesign); unreleased.

## The problem

The two-way diff (`twoWaySync.ts`) is careful. What goes *into* it was not:

- **Technicians were matched by display name only.** The filter's `assignee` compared a name.
  Jira assigns by `accountId`, so the name was never pushed into JQL and the first run pulled
  the whole project. ConnectWise's `resources` is a comma-joined list of member identifiers, so
  a filter for `jsmith` never matched a ticket assigned to `jsmith, bdoe`.
- **ConnectWise pushed nothing down.** The query was `board = X` only; every first run
  downloaded the board's entire history and threw most of it away.
- **Nobody could see the size of a job before enabling it.**
- **A ticket that left a job's filter was silently followed forever**, and a ticket imported by
  one job was reconciled by every job on the same account.
- **Nothing flowed out.** `TicketProvider.pushTicket` existed and was never implemented, so a
  ticket born in AnchorDesk could not be created in the PSA.

History limits were considered and rejected: AnchorDesk is retentive by design.

## Decisions

### 1. Tickets belong to one job

`Ticket.syncJobId` records which sync job owns a ticket. Every scope question is per job.

- Import stamps it. The first job to import a ticket owns it; other jobs whose scope overlaps
  skip it instead of reconciling it a second time.
- Boot backfill (`dataMigrations.ts`) assigns existing tickets where exactly one job exists for
  their provider and account. Where several jobs share an account the owner can't be proven;
  those tickets are adopted by the first job whose filter they match, and a run that sees one
  outside its own filter leaves it unchanged and says so in the run log rather than guessing.

### 2. Technicians by ID

The shared filter gains `assigneeId` (include and exclude), matched against every identity on
the ticket: the Jira `accountId`; the ConnectWise owner identifier and each identifier in
`resources`. The editor picks people from the remote system (`GET /sync/people`), and the
filter stores their display names beside the IDs for rendering only.

Name-based `assignee` stays for existing jobs, and for ConnectWise it now matches any one of the
listed resources instead of the whole string.

### 3. Push-down for both providers

Push-down must stay a **superset** of the local predicate — anything dropped remotely can never
be recovered — and the local `matches()` remains the authority.

| Filter | Jira (JQL) | ConnectWise (conditions) |
|---|---|---|
| `assigneeId` include | `assignee IN (…)` | `owner/identifier IN (…) OR resources contains "…"` |
| `assigneeId` exclude | `(assignee NOT IN (…) OR assignee IS EMPTY)` | local only |
| `status` / `priority` include | `IN (…)` | `status/name IN (…)`, `priority/name IN (…)` |
| `companyName` include | `project IN (…)` | `company/name IN (…)` |
| other excludes | as before | local only |
| `assignee` (name) | local only | local only |

As with Jira today, the filter narrows the *first* run only. Incremental runs use the job's base
scope so a ticket that moves out of the filter is still seen — which is what makes §4 possible.

### 4. Leaving scope stops sync, visibly

When a ticket owned by a job no longer matches that job's filter, it first gets **one final
reconcile**, so the change that took it out lands locally — with an open-tickets-only filter, a
ticket closed remotely must arrive closed; reassigned, it must show who. If that reconcile is a
conflict or an error, it is not detached that run: the problem is settled first. Then sync
**stops** and the local copy stays:

- `syncState = detached`, with `syncDetachedAt` and a plain-language `syncDetachReason`
  ("assignee is now Bob Smith; job *Joe's queue* only syncs Joe Tran").
- A system note on the timeline, an audit row, and a live update.
- Local edits keep working but are not queued as sync work. The revision at detach time is kept,
  so the ticket knows whether it was edited while detached.
- **Back in scope resumes automatically.** If only the remote changed, it is pulled; if only the
  local copy changed, it is pushed; if both changed, it is held as a conflict for a person to
  resolve — the same rules as any other reconcile.

**Full scans sweep.** A first run — and the first run after any scope edit, which resets the
watermark — fetches *through* the filter, so an owned ticket now outside it isn't returned at all.
After a full scan, every owned ticket the remote didn't return is read back by id: a pinned one is
reconciled and keeps syncing; any other gets its final reconcile and detaches with the real reason
(the clause it now fails, or "no longer in this job's board / project or JQL"). One that can't be read
back is left alone and reported — a network error must never look like "left scope".

Known limit: on *incremental* runs, a ticket that leaves the job's base scope (moved to another
ConnectWise board, out of the JQL's project) isn't returned, so it's only caught by the next full
scan. Its local edits still push in the meantime.

### 5. Bypass requests

Anyone who can edit tickets can ask for a detached ticket to keep syncing anyway, with a reason.
Any admin can approve or reject. Approval **pins** the ticket (`syncScopePinned`): it keeps
syncing regardless of the filter until an admin unpins it. Admins can resume a ticket directly,
which records an approved request in their name. Requests notify admins; decisions notify the
requester. Pending requests are listed under Admin → Ticket sync.

### 6. Create in the PSA

New ticket gets a first-class **Sync to external PSA** choice listing enabled two-way jobs that
can create (`GET /sync/destinations`). An existing local ticket can be sent from the ticket
dialog. Either way the local ticket is created first and then pushed
(`POST /tickets/:id/sync-out`), so a remote failure never loses the ticket.

- Jira: needs the job's project key; issue type from the job (`createIssueType`) or the
  project's *Task* type, else its first standard type.
- ConnectWise: the job's board; the company is matched by exact name, falling back to the job's
  `createCompany` identifier; summary truncated to ConnectWise's 100 characters.
- A ticket a person explicitly sent is pinned: it syncs even if it doesn't match the job filter.
- After creation the ticket adopts the PSA's status and priority, as imported tickets do — pushing
  AnchorDesk's own vocabulary ("New") into a remote workflow ("To Do") would fail. The assignee is
  pushed as a best effort, and anything that didn't carry over is written on the ticket.
- An email ticket can be sent: its `externalId` was the root Message-ID, but replies thread on the
  root *note*'s Message-ID, and the ticket's `source` keeps its email provenance.
- Create-only settings (`createIssueType`, `createCompany`) and the filter's picker labels don't count
  as scope changes, so editing them doesn't force a full rescan.

### 7. Preview

`POST /sync/preview` counts what a job's first run would import, using Jira's approximate-count
search and ConnectWise's ticket count, and says which filter clauses were enforced locally (so
the number is an upper bound).
