# 2.7 — "Pass the flinch test, badly"

Status: **in progress** (opened 2026-07-26).

[docs/roadmap-3.0.0.md](roadmap-3.0.0.md) defines 3.0 by one question: *if a
stranger wanted to buy AnchorDesk tomorrow, could we say yes without flinching?*
Three product gaps decide that answer — a **customer portal**, **reporting**, and
a **knowledge base** — and after two releases (2.5 sync correctness, 2.6
relations) all three are still at zero.

So 2.7 is deliberately breadth-first. **We cross the whole chasm badly, then walk
each crossing back with improvements.** A shallow portal that a requester can
actually log into teaches us more than another quarter of design docs, and it
converts three unknown-unknowns into three known, critiqueable implementations.

What "badly" is allowed to mean, and what it is not:

| Allowed | Not allowed |
|---|---|
| Sparse features, obvious gaps, plain styling | Anything that lies to the user |
| "v1" scope with follow-ups listed | Silent failure, or a metric that looks right and isn't |
| Fewer charts, fewer article fields, fewer portal actions | Skipping RBAC, skipping the audit log, skipping mobile |
| Deferring polish | Skipping tests on money/permission/correctness paths |

That second column is not negotiable. 2.5 and 2.6 both existed because something
looked like it worked and didn't; a reporting release that repeats that mistake
is worse than no reporting at all.

---

## The invariants every workstream inherits

These are house rules from CLAUDE.md and prior releases. They are restated here
because each workstream is implemented independently and none of them may drift.

1. **Repository pattern.** Routes never touch Prisma directly. All DB access goes
   through `src/repositories/*`.
2. **Audit everything.** Every mutation calls `auditRepository.record()` before
   responding.
3. **RBAC.** `middleware/auth.ts` resolves the principal; `requireRole('admin')`
   gates admin surfaces; `readonly` may not mutate.
4. **MCP parity is a release invariant.** Every workflow exposed through
   web/REST ships equivalent MCP tools *in the same change*. Read-only surfaces
   get read-only tools.
5. **Mobile-first, 360px, hard requirement.** Every new view is usable at 360px,
   dialogs go full-screen via `useIsPhone()`, and every new view is added to
   `docs/scripts/capture-mobile-media.mjs` **and** `docs/scripts/mock-api.mjs`.
   See [docs/mobile.md](mobile.md).
6. **Vocabulary.** `services/ticketVocab.ts` is the server's status/priority
   source of truth. Do not invent values.
7. **Fail closed.** A missing invariant aborts startup (`db/pgExtras.ts`); a
   request that cannot be answered truthfully returns an error, not a guess.

---

## Workstream A — The SLA and event spine

**This is the foundation. Reporting is not a charts feature, it is a
data-modelling feature, and today the model cannot answer the questions.**

Three concrete defects, each of which silently corrupts any report built over it:

1. **There is no history of status.** `Ticket.status` is current-state only.
   "How long did tickets sit in New?" is unanswerable except by parsing
   `audit_log` JSON blobs, a table indexed for "show me this ticket's history",
   not for aggregation across a year of rows.
2. **SLA compliance is retroactively mutable — the dangerous one.**
   `responseDueAt` / `resolutionDueAt` are recomputed when priority or company
   changes; `SlaPolicy` rows are edited in place; `Ticket.slaPolicyId` is
   `onDelete: SetNull`. So "did we hit our SLA last quarter?" changes answer when
   somebody edits a policy today, and becomes unanswerable if they delete one.
3. **Time entries have no work date.** `Note.timeStart` / `timeStop` are
   nullable, so a duration-only entry knows only when the *note* was written.
   A day-spread calendar has nothing to place it on.

### A1. `TicketEvent` — an append-only fact table

A second subscriber on the existing `eventBus` Observer (**not** a new
mechanism, and **not** a replacement for `audit_log` — audit stays the
human-readable revision history; this is the machine-readable metric spine).

```prisma
model TicketEvent {
  id         BigInt   @id @default(autoincrement())
  ticketId   Int      @map("ticket_id")
  /// created | status_changed | assigned | first_response | resolved | reopened
  /// | merged | sla_breached
  kind       String   @db.VarChar(40)
  fromValue  String?  @map("from_value") @db.VarChar(100)
  toValue    String?  @map("to_value") @db.VarChar(100)
  actor      String?  @db.VarChar(255)
  companyId  Int?     @map("company_id")
  teamId     Int?     @map("team_id")
  assigneeId Int?     @map("assignee_id")
  priority   String?  @db.VarChar(50)
  occurredAt DateTime @default(now()) @map("occurred_at")
}
```

Denormalising company/team/assignee/priority onto the row is deliberate: a
report grouped by company must reflect the company **at the time**, and must not
require a join to a mutable ticket row.

Index for the queries that will actually run: `(occurredAt)`,
`(ticketId, occurredAt)`, `(kind, occurredAt)`, `(companyId, occurredAt)`.

**Backfill:** one idempotent pass in `db/dataMigrations.ts` reconstructing events
from `audit_log`. Reconstructed rows are flagged (`actor = 'backfill'`) and the
Reports UI must say so — a chart covering reconstructed history is labelled
"includes reconstructed history before <date>". Never present a reconstruction as
a recording.

### A2. Frozen SLA targets

Add a **`TicketSlaSnapshot`** written once when a ticket's SLA is first
established, recording `policyId`, `policyName`, `responseMinutes`,
`resolutionMinutes`, `responseDueAt`, `resolutionDueAt`, and `establishedAt`.
Later policy edits, priority changes, and policy deletion do not touch it.

The live `Ticket.response/resolutionDueAt` fields keep their current behaviour —
they drive the working UI and the scheduler. The snapshot is what reporting
reads, so "did we meet what we promised" has exactly one answer forever.

When a priority change legitimately re-targets a ticket, write a **new**
snapshot rather than mutating the old one, and let reports show the ticket
against the target in force at the moment being measured.

### A3. Work date on time entries

Add `workedAt DateTime?` to `Note`. Populate from `timeStart` when present,
else default to the note's `createdAt` at write time (so it is a *recorded*
value, not a runtime guess). Expose it in the time-entry API and MCP `log_time`
so a tech can log Friday's work on Monday — the single most common real-world
time-entry case, and currently impossible to represent.

### A4. Deliverables

- Prisma models + `pgExtras` indexes; boot-time idempotent backfill.
- `ticketEventRepository` with the aggregate queries Workstream B needs.
- Emission wired into the existing event/repository paths — no route changes.
- Tests: event emitted exactly once per transition; snapshot immutable across
  policy edit/delete; backfill idempotent (running twice ≠ double rows).

---

## Workstream B — Reporting, and the TIME calendar

Two surfaces over Workstream A's spine. **Go full BI analyst: a small number of
reports that answer a question a manager actually asks, not a wall of charts.**

### B1. `/reports/*` — server-side aggregation

Aggregation happens in Postgres, never in the client. Every endpoint takes a
date range plus optional company / team / assignee filters, and every response
states its own provenance (`{ data, meta: { from, to, includesReconstructed } }`).

The v1 report set, chosen because each answers a real question:

| Report | The question it answers |
|---|---|
| Volume over time (created vs resolved) | "Are we keeping up, or is the backlog growing?" |
| First-response and resolution distributions | "How long do people actually wait?" — **percentiles (p50/p90), not averages**, because a mean response time is dominated by outliers and reliably lies |
| SLA compliance (met / at-risk / breached) | "Are we keeping the promise we sold?" — read from the snapshot |
| Backlog age buckets | "What is rotting?" |
| Per-tech and per-team throughput | "Where is the load?" |
| Time logged by company | "What do we bill?" — the billing-export seed; CSV out |

**Percentiles over averages is a stated design rule for this workstream.**

### B2. Reports view

Mobile is the hard part here and the rule does not bend. **One chart per screen
at `xs`**, summary stat tiles above the fold, horizontal scroll only inside a
chart's own container, never the page. Load the `dataviz` skill before writing
any chart code.

### B3. The TIME calendar

The feature that makes time entry worth doing:

- **Day spread** — a technician's logged time laid out across the day, so the
  gaps are visible. Gaps are the point: unlogged time is the thing that costs
  money.
- **Per-ticket SLA timeline** — one ticket's life as a horizontal track:
  created, first response, status changes, the SLA targets in force, breach
  points.
- Built on `react-big-calendar` (already the decided choice) over `workedAt`
  and `TicketEvent`.
- Portfolio-wide SLA timeline is explicitly **tier 4** — cut it first.

### B4. MCP parity

Read-only tools mirroring each report under normal RBAC, so an agent can answer
"how did we do last week" without scraping the UI.

---

## Workstream C — Customer portal

The first checkbox on every helpdesk RFP, and the largest single lift. Today an
end user can only interact by email.

- **Requester identity rides `Contact`, not `User`.** A requester is a new
  principal type, *not* a role on the staff user model — conflating them is how
  a requester ends up able to see internal notes.
- **Auth: magic-link email** (reuses the mail stack, stores no password).
  Single-use, short-lived, hashed at rest exactly like `ApiToken` and the OAuth
  codes in `services/auth/oauthProvider.ts`. Sessions reuse the existing
  server-side session table with a scope flag distinguishing them from staff
  sessions.
- **Scope (v1):** submit a ticket (company inferred from the contact), list own
  tickets, view status and public replies, add a comment, attach a file.
- **The hard boundary:** internal notes, time entries, audit history, device
  links, and sync state **never** serialize to a portal response. This is
  enforced by an explicit allowlist serializer with its own test, not by
  remembering to omit fields.
- **Separation:** distinct route tree (`/portal`) and its own slim bundle. The
  staff SPA is untouched.
- **Email parity:** a portal comment is an ordinary note with `via: portal` and
  threads into the same conversation; outbound replies still go by mail so the
  requester can answer either way.
- **Deflection** consumes Workstream D's search endpoint (contract below).

Security is the one place "badly" does not apply. A portal session that can read
another company's ticket is a breach, not a rough edge.

---

## Workstream D — Knowledge base

Smallest of the three product gaps, and it pairs with the portal.

- `KbArticle` (title, body HTML via the existing `RichTextEditor` + shared
  sanitizer, category, `visibility: internal | portal`, published flag, author,
  timestamps). Admin/tech CRUD; slug for stable linking.
- Search reuses the existing Postgres FTS + `pg_trgm` stack — the same approach
  as `ticketRepository.search`, not a new engine.
- **Shared contract, so the portal can be built in parallel with this:**

  ```
  GET /kb/search?q=<text>&visibility=portal&limit=5
    -> { items: [ { id, slug, title, excerpt, score } ] }
  ```

  Workstream C codes against exactly this shape. If KB is not merged yet, the
  portal degrades to hiding the deflection panel on a non-200 — it must not
  error.
- Portal renders published portal-visible articles; internal ones never leak.

---

## Sequencing, and what gets cut

Wave 1 runs in parallel (independent): **A**, **C**, **D**.
Wave 2: **B**, which needs A's spine.

Cut order if we run out of room — from the bottom, and we still ship something
true:

1. Portfolio-wide SLA timeline (B3)
2. Per-tech/per-team throughput (B1)
3. TIME calendar day-spread (B3) — painful, but reporting stands without it
4. KB deflection hook in the portal (C/D seam)

**Never cut:** the Workstream A spine, the portal's field-allowlist boundary,
audit coverage, MCP parity for whatever *does* ship, or the 360px rule.

## Integration notes

Workstreams are implemented in separate worktrees and merged, so each must:

- Add Prisma models in its own block at the **end** of `schema.prisma`.
- Add new files rather than restructuring existing ones wherever there is a
  choice; shared touchpoints (`index.ts` route registration, `api/client.ts`,
  `DashboardDrawer.tsx`, `mock-api.mjs`, `capture-mobile-media.mjs`) will
  conflict and are resolved at integration.
- Ship green: `npm test` and `npm run build` in both `backend/` and
  `web-client/`, plus `npm run lint` in `web-client/`.
