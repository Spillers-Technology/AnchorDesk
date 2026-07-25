# AnchorDesk 2.6.0 — Relations (minor)

Relations adds the two things a helpdesk is expected to have and AnchorDesk
didn't: **merging a duplicate ticket into the one you're keeping**, and
**parent/child hierarchy**. It also carries the sync correctness pass that was
developed as 2.5 and never released on its own — so upgrading from 2.4.2 picks
up both. Node.js 22.12+ and the local-first PostgreSQL model are unchanged.

## Merge, and the promise it makes

Merging folds a duplicate into the ticket you're keeping. Notes — including
email correspondence and the time entries riding on them — attachments,
checklist items, children, labels, and device links all move to the target.

The source is **never deleted**. Its ticket number is already loose in the
world: in email subject tokens, in external references, in somebody's browser
history. So it stays as a resolvable tombstone (`Merged into #N`), and every one
of those still lands somewhere sensible. Its status becomes plain `Closed` — an
existing value, so your Kanban columns, saved views, and automation conditions
are untouched.

**A merge is a local record operation. It never pushes.** No provider call is
made on the merge path: not a close, not a comment, not a link. Jira has no merge
primitive, so any push invented here would be a guess about what you meant,
applied to a system we cannot roll back. Instead, a merged ticket **stops
reconciling**, and the product says so in so many words before you commit:

> **HELP-1 stays open in Jira.** AnchorDesk will stop syncing it. The remote
> issue is not closed, commented on, or linked by this merge.

That sentence is a checkbox you have to tick, not a toast you can miss. The same
gate covers merging across companies, and it applies to MCP too — an agent
cannot merge past a warning a human would have had to read.

**Unmerge replays the ledger exactly.** Every merge writes down the precise
note, attachment, checklist-item, child, label, and device ids it moved, so
undoing it restores that and nothing else. Anything added to the survivor after
the merge stays on the survivor — the behaviour people expect, and the only one
an honest undo can promise. A ledger that fails re-validation refuses the
restore rather than doing half of it.

**Replies follow the merge.** Every inbound-mail thread-resolution path walks
`mergedIntoId` to the surviving ticket. Without that, a customer replying to the
thread you just merged away opens correspondence on a closed ticket nobody is
watching — the single most likely real-world regression in the whole feature.

## Parent/child hierarchy

One level, deliberately: a ticket that has a parent may not itself be a parent.
That removes cycle detection entirely and matches what JSM subtasks actually
allow. It's enforced twice — under row locks in the repository, and by a
Postgres trigger. The repository protects the application path; the trigger
protects the `psql` session at 2am, which is how this data actually gets
corrupted.

The ticket cockpit gains a hierarchy panel: a parent picker, and a child list
with status, priority, and "N of M done" progress. Hierarchy is never pushed or
pulled — Jira subtasks and ConnectWise parent-child stay invisible to it in both
directions.

## Surface

REST: `GET /tickets/:id/merge-preview?targetId=`, `POST /tickets/:id/merge`,
`POST /tickets/:id/unmerge`, `GET /tickets/:id/children`, `parentId` on
`PATCH /tickets/:id` (`null` detaches), and `?parentId=` / `?hasParent=` /
`?includeMerged=` list filters.

Per the release invariant, MCP ships in the same change: `preview_ticket_merge`,
`merge_tickets`, `unmerge_ticket`, `set_ticket_parent`, `list_ticket_children`,
with `get_ticket` gaining `parent`, `children`, and `mergedInto`.

## Sync you can actually trust (developed as 2.5)

- **Jira sync works again.** Atlassian removed `/rest/api/3/search` (410 Gone);
  we moved to `/rest/api/3/search/jql`. The incremental cutoff now uses unquoted
  epoch milliseconds — a quoted literal is reinterpreted in the *account's*
  timezone, which silently skipped hours of updates on every run.
- **Bad Jira credentials no longer fail silently.** `/search/jql` answers
  `200 {"issues":[]}` for an invalid or absent token — it quietly degrades to
  anonymous access. Only `/myself` returns 401, so identity is verified whenever
  a fetch comes back empty.
- **Connections are first-class records**, so one install can sync several Jira
  tenants (external ids are only unique *within* an account — two sites both
  have `HELP-1`). Credential resolution fails closed: a disabled or deleted link
  never falls back to another tenant's account.
- **Every sync attempt is recorded** — success/degraded/error, duration, exact
  counters, latest issue, actor — including zero-ticket successes and failures
  before fetch. Runs are serialized per external account across replicas.
- **Conflicts are an unconditional hold.** Previously a held conflict was
  cleared on the next fetch and your local edit overwritten.
- **Admin → Ticket Sync** is now the single home for connections, jobs,
  filters, manual runs, and run history.
- **Remote error bodies are redacted** before they reach logs or API responses:
  a wrong `baseUrl` receives the Basic auth header and can echo it back.

## Notable fixes in this release

The pre-release review pass found several defects in the new merge code that are
worth calling out, because they are the kind that lose data quietly:

- **Unmerge lost labels and device links.** The merge deletes every source
  association, but the ledger recorded only the ids *added* to the target — so
  any label both tickets carried was stripped from the source and never
  restored. The ledger now records the source's full sets.
- **An in-flight sync could overwrite a merge**, stamping the tombstone synced
  or reapplying a remote open status over it. Merge now bumps `syncRevision`, so
  any reconcile already past the tombstone guard writes zero rows.
- **Reciprocal merges could build a cycle** — A→B and B→A previewing at the same
  time could both commit. The survivor is now re-checked under the lock.
- **The hierarchy trigger read an unlocked snapshot**, so two direct
  transactions could commit a cycle between them. It now locks the prospective
  parent, and startup validation allowlists origin/always rather than merely
  rejecting disabled — a replica-only trigger enforces nothing.
- **Inbound mail's duplicate-recovery path skipped merge resolution**, landing
  replies on a tombstone.
- Merging a parent into a child ticket is now refused with an explanation rather
  than a raw constraint violation mid-transaction.

Known limitations are recorded in
[docs/roadmap-relations-2.6.md](docs/roadmap-relations-2.6.md#known-limitations-at-260).

## Upgrading

Pull, restart, done — see [docs/upgrading.md](docs/upgrading.md). Boot creates
and verifies the new hierarchy trigger and the live-merge-ledger unique index as
fail-closed startup invariants.
