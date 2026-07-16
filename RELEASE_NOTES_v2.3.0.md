# AnchorDesk 2.3.0 — Compass Calibration (minor)

Compass Calibration is a follow-up pass on 2.2's Clock & Compass: it brings
the MCP surface to parity with the 2.2 REST filters, makes custom-field
filtering survive its own lifecycle, keeps manual deadlines out of two-way
sync, and splits the project site into a product landing page and a
documentation hub. Node.js 22.12+ and the local-first PostgreSQL model are
unchanged.

## MCP parity for custom-field filters

- `list_tickets` accepts a `customFields` argument: exact-match typed filters
  keyed by field key, validated against the definitions with the same
  coercion path REST uses (`coerceCustomFieldFilters`). Saved views that
  include custom-field filters can now be replayed by agents exactly as the
  `list_saved_views` tool description promises.
- Validation errors return as tool errors with the same messages REST sends
  as 400s, so agents and humans debug identically.

## Custom-field filtering hardening

- **Archived definitions filter again.** Archiving a field preserves ticket
  data by design, so `cf.<key>` filters and saved views over that data now
  keep working instead of returning `unknown custom field`.
- A repeated `cf.<key>` query parameter (which Fastify delivers as an array)
  is rejected with a clear 400 instead of silently matching nothing.

## Manual deadlines stay local

- Editing only local fields (`dueAt`, team routing, custom fields,
  company/contact links) on a ConnectWise or Jira ticket no longer marks it
  sync-pending or kicks a reconcile. Only fields two-way sync fingerprints
  and pushes (status, priority, assignee, title, description) do — so setting
  a deadline can no longer manufacture a sync conflict that a human has to
  resolve.
- The printable ticket export includes the effective due date, marked
  "(manual deadline)" when a human override is active.

## Automation condition semantics (action may be required)

- `dueAt` in automation conditions now matches **only a human-set manual
  deadline**. A new `effectiveDueAt` field carries the deadline the
  resolution clock actually runs against (manual override, else the SLA
  resolution target).
- **Upgrade note:** an existing rule using `dueAt` with `set`/`gte`/`lte` to
  mean "has any deadline" should switch to `effectiveDueAt`; rules that meant
  "a human promised a date" now work as their author intended. The rule
  editor's helper text documents both fields.

## Platform and site

- Web client TypeScript 5.2 → 6.0.3 with typescript-eslint 7 → 8. TypeScript
  7 (the Go-native compiler already powering the backend build) is blocked
  for the web client until typescript-eslint supports it.
- The GitHub Pages site is now two pages: a focused product landing page and
  a documentation hub carrying the release detail, platform grid, quickstart,
  themes, integration status, and guide links.
- `docs/admin-rework-2.5.md` records the admin console assessment, the
  ticket-checklist specification, and the planned rework.
- CLAUDE.md's architecture diagram no longer lists inbound IMAP as "planned"
  (`imapService` has shipped since 1.6).

## Images

- `ghcr.io/spillers-technology/anchordesk-backend:2.3.0`
- `ghcr.io/spillers-technology/anchordesk-web-client:2.3.0`

## Verification

- Backend: 30 suites / 228 tests, `prisma validate`, `tsc` build.
- Web: production build, ESLint (typescript-eslint 8), 21 Vitest tests
  including the phone-width full-screen dialog guards.
