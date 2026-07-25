# Sync 2.5 — "sync you can actually trust"

Status: **in progress** (opened 2026-07-25).

This plan came out of a concrete failure: the author of AnchorDesk could not get
Jira sync working on his own homelab install, and got no error explaining why.
Five independent backend causes were found and fixed (see *Backend, already
landed* below). The UX causes are what this roadmap addresses, plus the one
architectural decision that fell out of the review.

Source material: [docs/sow-sync-ux.md](sow-sync-ux.md), a Material UX statement
of work covering the setup flow.

---

## The architectural decision

**One Jira account and one ConnectWise account per install is not a permanent
constraint. Credentials move from a global setting into a first-class
`Connection` record, and a sync job points at one.**

Why now rather than later:

- `SyncProvider` already supports N rows — unique name, own config, own
  `enabled`, own `lastSyncedAt`, own sync log. The multi-job data model exists.
  The only singleton is the credential blob reached through the module-global
  `config.jira` / `config.cwm`.
- That coupling is 12 references (3 `jiraService`, 2 `JiraProvider`,
  7 `connectwiseService`). Contained.
- Deferring it means building the Connections UI against a singleton and then
  rebuilding it. The refactor is cheaper before the UI than after.
- AnchorDesk targets MSPs. An MSP syncing several clients' tenants is a normal
  case, not an exotic one — and tickets already carry per-source provenance
  badges, so the UI is conceptually multi-account already.

**Consequence:** Workstream D must land before any Connections UI (G).

---

## Workstreams

Lettered so they can be referenced independently of the milestone they land in.
Effort: **S** = 1–2 days, **M** = 3–5 days, **L** = 1–2 weeks (solo).

| # | Workstream | Effort | Milestone | Issue |
|---|---|---|---|---|
| A | Consolidate IA — remove top-level Sync, add Admin → Ticket sync | S | Ground Truth | [#35](https://github.com/Spillers-Technology/AnchorDesk/issues/35) |
| B | Honest setup state — configured check, RBAC, ConfirmDialog, phone dialogs | S | Ground Truth | [#36](https://github.com/Spillers-Technology/AnchorDesk/issues/36) |
| C | Surface the sync error already recorded in `sync_log` | S | Ground Truth | [#37](https://github.com/Spillers-Technology/AnchorDesk/issues/37) |
| D | `Connection` entity — schema, repository, routes, migration off the singleton | M | Many Hands | [#38](https://github.com/Spillers-Technology/AnchorDesk/issues/38) |
| E | De-singleton the provider clients — pass a connection instead of reading global config | M | Many Hands | [#39](https://github.com/Spillers-Technology/AnchorDesk/issues/39) |
| F | Connection testing — non-mutating credential verification | M | Many Hands | [#40](https://github.com/Spillers-Technology/AnchorDesk/issues/40) |
| G | Connections + sync jobs UI | L | Many Hands | [#41](https://github.com/Spillers-Technology/AnchorDesk/issues/41) |
| H | Editable sync jobs, single query owner | M | Sharp Instruments | [#42](https://github.com/Spillers-Technology/AnchorDesk/issues/42) |
| I | Provider-neutral filter editor | M | Sharp Instruments | [#43](https://github.com/Spillers-Technology/AnchorDesk/issues/43) |
| J | `SyncRun` health model — healthy/degraded/failing, consecutive failures | L | Vital Signs | [#44](https://github.com/Spillers-Technology/AnchorDesk/issues/44) |
| K | Docs + website cohesion | S | continuous | — |
| L | Mobile capture matrix + 360px regression proof | S | continuous | — |

GitHub milestones: [Ground Truth](https://github.com/Spillers-Technology/AnchorDesk/milestone/1) ·
[Many Hands](https://github.com/Spillers-Technology/AnchorDesk/milestone/2) ·
[Sharp Instruments](https://github.com/Spillers-Technology/AnchorDesk/milestone/3) ·
[Vital Signs](https://github.com/Spillers-Technology/AnchorDesk/milestone/4)

### Milestone 1 — **Ground Truth** (A, B, C)

Make the product stop lying about its own state. Nothing here needs a schema
change, and each item independently prevents part of the original failure.

The single worst offender: the Jira card renders "configured" when a site URL
and email exist, **without checking whether an API token was ever saved**
(`AdminView.tsx`). That is the element that most directly caused the reported
failure.

### Milestone 2 — **Many Hands** (D, E, F, G)

The architectural decision above, plus the UI that depends on it. D and E are
backend-only and land first; F becomes possible once a connection is a thing you
can point at; G is the consolidated admin surface.

### Milestone 3 — **Sharp Instruments** (H, I)

Sync jobs become editable in place, JQL gets exactly one owner, and the
provider-neutral filter (`syncFilter.ts`, shipped backend-only) finally gets an
interface. This is the release that can advertise filtering.

### Milestone 4 — **Vital Signs** (J)

Replace timestamp-as-health with a durable run record. `lastSyncedAt` is an
incremental watermark and must stop being presented as proof of health.

---

## Backend, already landed (2026-07-25)

Fixed ahead of this roadmap, verified against a live Jira Cloud tenant:

- `/rest/api/3/search` → `/rest/api/3/search/jql`. The old endpoint returns
  **410 Gone**; the new one pages by `nextPageToken`, returns only `id` unless
  fields are named, and rejects unbounded JQL.
- Incremental watermark uses **unquoted epoch milliseconds**. A quoted UTC
  literal is reinterpreted in the account's own timezone — on this
  America/Indianapolis account the cutoff landed ~4h in the future, so
  incremental sync returned nothing. Proven empirically.
- `jira` accepted as a sync provider type (the UI offered it; the API refused).
- `syncScheduler` added — `runAllSync()` previously had exactly one caller, the
  manual Run button.
- Provider-level fetch failures now write a `sync_log` row. Previously a broken
  provider was indistinguishable from "nothing to sync".
- Conflict is now an unconditional hold. Previously a held conflict was silently
  cleared on the next fetch and the local edit overwritten.
- Title/description are genuinely two-way for Jira; providers declare
  `writableFields`, and pushes are verified against a re-read.
- `fromADF` preserves paragraph breaks (it used to turn `"a\n\nb"` into `"ab"`).
- Comment pagination walks to `total` instead of reading only the first page.
- `syncFilter.ts` — provider-neutral include/exclude filtering, applied locally
  and pushed down into JQL where safe.

---

## Progress log

**2026-07-25 — Milestones 2–4 fast-tracked in the working tree.** The
calendar-week estimates were dependency guidance, not artificial waiting
periods: Connections, editable/filterable jobs, and durable health now form one
coherent flow. Release, live-provider acceptance, and the real browser capture
matrix are still pending.

- **Trustworthy run health (#44/J):** every manual and scheduled attempt creates
  a durable `SyncRun`, including configuration failures, fetch failures, empty
  successes, and mixed outcomes. `SyncLog` rows link to the run for drill-down.
  Job cards now show Never run/Running/Healthy/Degraded/Failed, last attempt,
  last successful run, consecutive failures, latest actionable issue, and exact
  created/updated/notes/locally-filtered/skipped/conflict/error counts. Run
  history opens in a full-screen phone dialog with expandable record activity;
  bounded detail responses disclose when their newest 500 entries are a
  truncated view.
- **Scope-safe progress:** account/scope/filter edits clear the incremental
  watermark and increment `configRevision`. A finishing old-revision run uses a
  compare-and-set update, so it cannot restore the old watermark and
  permanently skip records newly visible under the edited scope. Health is
  derived only from the job's current revision while older run history remains
  inspectable.
- **Tenant and identity boundaries:** a Jira connection's site URL is immutable
  after creation (credential rotation is still allowed); a different site must
  be a new connection. Connection deletion now checks both jobs and imported
  tickets. Legacy null-connection ticket identity has a catalog-validated
  partial unique index; failure to create that correctness invariant aborts
  startup instead of becoming a warning.
- **Run safety:** the remote-result loop and pre-fetched pending backlog cannot
  reconcile the same ticket twice in one run. Manual and scheduled starts share
  a durable database mutex for the whole external account, so two jobs on one
  Jira connection (or the singleton ConnectWise account) cannot overlap even
  across backend replicas. Account/scope edits and job deletion serialize
  against that same running state. Terminal run writes are idempotent and
  retried after a lost database response, returned issue samples are bounded
  while counters remain exact, and stored/serialized error text is redacted at
  both boundaries.
- **Explicit tenant binding:** Jira jobs may no longer auto-select a sole
  enabled connection or fall back to process-global credentials. Every job must
  name the exact Jira account it may read/write. Rotating that account's email
  or token atomically clears every linked watermark, increments each job's
  health revision, and is refused while an account run is active.
- **No partial-success gaps:** ConnectWise ticket and note reads now walk stable,
  deduplicated pages and fail closed at a bounded safety cap instead of
  returning only the first 1,000 rows and advancing the watermark. Public
  `POST /tickets` also rejects all server-owned sync provenance, so an API user
  cannot manufacture an out-of-scope remotely writable ticket.
- **Upgrade safety:** settings seeding, sync data migrations, and the critical
  identity index now complete before the HTTP listener and scheduler start.
  `ticket_number_seq` and `pg_trgm` are also fail-closed runtime dependencies:
  the server will not listen if ticket creation or ranked search would be
  broken. Interrupted runs are recovered only after a four-hour stale grace,
  avoiding a new pod immediately marking another rolling pod's active attempt
  failed.
- **Regression proof added:** focused backend coverage now includes run
  status/counters, current-revision health, backlog de-duplication, terminal
  retries, overlap prevention, startup index validation, and tenant immutability.
  The mobile matrix adds run-history and expanded-run-detail states alongside
  the connection/job editors.

**2026-07-25 — Milestone 1 (A, B, C) + the H connectionId gap landed.** A fresh
admin can now go from zero to a running Jira sync entirely through Admin →
Ticket sync, at 360px, without reading documentation.

- **Backend (#42 slice):** `GET/POST/PATCH /sync/providers` gained a real safe
  `publicConfig` DTO (`projectKey`/`jql`/`board`/`filter`, never raw JSON),
  `connectionId` support with fail-closed validation (`syncProviderRepository.ts`,
  new), and audit on create/update/delete. Deleted the integration-level Jira
  `projectKey`/`jql` fields (config.ts, settingsService.ts, JiraProvider.ts,
  ticketProviderFactory.ts, .env.example) — per-job scope replaces them.
- **UI (#41/G, #35/A, #36/B):** New `TicketSyncPanel.tsx` under
  `?admin=ticket-sync` — Jira connections (add/edit/test/delete) plus a
  ConnectWise legacy-account card, and sync jobs (create/edit/enable/run/delete,
  a structured include/exclude filter editor, guided onboarding stepper when
  empty). Top-level "Sync" drawer destination removed entirely; `GET
  /sync/providers` and `/sync/log` are now admin-gated to match. `ConfirmDialog`
  replaces `window.confirm`; both new dialogs are full-screen at phone width
  (vitest guard extended) and joined the mobile capture matrix
  (`admin-ticket-sync`, `ticket-sync-connection-editor`, `ticket-sync-job-editor`).
- **UI (#37/C):** Job rows show the latest `sync_log` error and relabel
  `lastSyncedAt` "Synced through — an incremental watermark, not proof the last
  run fully succeeded" rather than presenting it as health. A durable
  `SyncRun` model (workstream J) is still the real fix; this is the honest
  label pending that.
- **Codex found two release blockers in code that predates today** (the D/E/F
  landing above), surfaced by today's diff: `dataMigrations.ts`'s connection
  adoption (a) never carried a job's legacy global JQL/project scope onto the
  job it just linked, so any adopted job with no scope of its own silently
  widened to every visible project the moment it got a connection, and (b) was
  adopting ConnectWise as a `Connection` despite that being the exact state
  `connectionRepository.ts` says must not exist. Both fixed:
  `adoptLegacyCredentialsAsConnections` now backfills `projectKey`/`jql` onto a
  job only when it has neither of its own, and Jira is the only type adopted;
  a new idempotent `purgeIllegalConnectwiseConnections` boot step unlinks and
  deletes any ConnectWise connection a previous boot already created. Also
  fixed from the same review: `syncProviderRepository`/`connectionRepository`
  mutation + audit-log write now commit in one transaction (were two separate
  statements — a failed audit write left a committed, unaudited mutation);
  `publicConfig`/`mergeJobConfig` now re-validate stored `filter`/scope through
  the same parser used on write instead of trusting existing JSON, so a
  stray/malformed key in an old row can't leak through the read DTO or survive
  an unrelated edit; and several route inputs (`config: null`, a non-string
  `name`, `enabled` as a string, a PATCH containing only unrecognized fields)
  that previously reached the repository and either 500'd or silently no-op'd
  now 400 at the route.

**2026-07-25 — Workstreams D + E + F landed (backend).** Reviewed by four
adversarial passes; each found real defects that were fixed rather than argued
away. Highlights of what the reviews caught:

- **Ticket identity was global per provider type.** `@@unique([externalId,
  externalProvider])` omitted the connection, so two Jira sites both containing
  `HELP-1` would collide — tenant B's import would find tenant A's row, merge
  B's fields into it, and never create B's ticket. Identity is now scoped to the
  connection.
- **Credential resolution failed open.** A disabled or deleted connection fell
  through to "the sole enabled account of that type", which could authenticate
  as customer B and push customer A's note into B's tenant. An explicit link is
  now binding and fails closed.
- **ConnectWise was not actually de-singletoned.** The factory resolved
  credentials and then discarded them, so a CW job would record per-tenant
  provenance that never controlled the request — worse than the honest
  singleton. CW connections are blocked until its client is de-singletoned.
- **Remote error bodies reached `sync_log` and server logs verbatim.** A wrong
  or hostile `baseUrl` receives the `Authorization: Basic …` header and can echo
  it back. Bodies are now redacted and length-bounded.
- **Boot ordering.** Data migrations ran before settings were seeded, so a fresh
  env-only install would not adopt credentials until its second restart.

### The live discovery

Jira Cloud's `/rest/api/3/search/jql` returns **HTTP 200 with
`{"issues":[],"isLast":true}`** for an invalid token, a wrong-type token, or no
credentials at all — it degrades to anonymous access, which sees nothing in a
private project. Only `/myself` returns 401. Bad credentials were therefore
indistinguishable from a quiet sync, permanently and with nothing in the log.
`JiraProvider` now verifies identity whenever a result set is empty
([#45](https://github.com/Spillers-Technology/AnchorDesk/issues/45)).

This is also why connection testing checks *visible projects* rather than just
authentication: an account that authenticates but can browse nothing would sync
silently forever.

## Follow-ups deliberately not done yet

Carried forward so they are not lost:

- **Per-field sync policy** (pull-only / push-only / two-way / never). The
  current model can only say *whether* a provider can write a field, not what
  the shop wants. ConnectWise title edits are reported as unsyncable rather than
  silently dropped, but that is a symptom of the missing policy.
- **Three-way merge + diff resolution UI.** `remoteHash` is a single fingerprint
  over all fields, so any remote change means "remote changed" and conflict
  resolution is one binary choice with no view of what differs. Storing a
  per-field baseline turns this into a real base/local/remote merge.
- **Crash-aware sync leases/heartbeats.** Account-wide database locking now
  prevents overlap across jobs and backend replicas. A crashed worker still
  leaves its durable `running` row blocking that account until the conservative
  four-hour startup recovery grace expires. Add owner/heartbeat/lease expiry for
  faster, provably safe takeover.
- **Retry backoff.** `reconcilePendingLocal` retries on every run with no
  `nextRetryAt`.
- **Dry-run preview** — "what would this sync change?", modelled on the 2.4.0
  automation preview.
- **De-singleton the ConnectWise client** so CW can be a connection type. Until
  then `SUPPORTED_CONNECTION_TYPES` is `['jira']` and CW keeps its single global
  account — honest, rather than recording provenance that did not apply.
- **Migration provenance assumption.** Adoption attaches every existing external
  ticket of a type to the one adopted connection. If an install historically
  repointed its credentials at a different tenant, older tickets are attributed
  to the wrong account. Logged loudly at migration time; needs a quarantine path
  before any install with that history upgrades.
- **Authentication independent of result cardinality.** The `/myself` probe only
  fires when a fetch returns nothing. A token that is invalid but reads a
  publicly-browsable project still bypasses it.
- **`Ticket.syncConnectionId` still has no foreign key.** Repository deletion
  now blocks while either jobs or tickets reference the connection, but direct
  database changes can still create an orphan; a formal relation/migration
  remains preferable.
- **Mutation + audit log write is not atomic anywhere in the app except
  `syncProviderRepository`/`connectionRepository`** (fixed today, 2026-07-25).
  Every other repository still does the mutation and the `auditRepo.record()`
  call as two separate statements against the shared client — if the audit
  write fails, the mutation stays committed and unaudited.
  `auditRepository.record()` now takes an optional `db` (transaction client)
  param specifically so this is easy to fix incrementally elsewhere; it hasn't
  been applied beyond the two repositories touched today.
- **Filter editor is a plain structured form, not the full workstream D/I
  spec.** `TicketSyncPanel.tsx`'s `FilterEditor` covers the four fields with
  include/exclude and an unfiltered-job warning, but skips the accordion
  layout, remote-vocabulary suggestions beyond local ticket statuses/
  priorities, and remote-side result-count preview.
- **`ticketsFiltered` means locally rejected after fetch.** Jira may push a safe
  subset of the same filter into JQL, so remote-side exclusions are not
  countable under the current provider contract. The UI labels the counter
  "filtered locally" rather than presenting it as the total remote exclusion
  count.
- **Run retention and job archival need a policy.** Hard-deleting a job still
  cascades its run/log history (the confirmation says so), and scheduled runs
  have no age-based pruning. Prefer soft archival plus an explicit retention
  setting before calling the operational history permanent evidence.
- **Mobile capture matrix still lacks dedicated empty/connection-error/
  run-failed states.** It now covers `admin-ticket-sync`,
  `ticket-sync-connection-editor`, `ticket-sync-job-editor`,
  `ticket-sync-run-history`, and `ticket-sync-run-detail`, but was **not
  executed** in this session — no
  Playwright available in the sandbox; verified only that the script's
  selectors match the rendered component text. Run
  `node docs/scripts/capture-mobile-media.mjs` for real before trusting it.
