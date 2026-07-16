# AnchorDesk 2.4.0 — "Checklist & Console" (plan)

Status: **active** (re-scoped 2026-07-16). The admin rework originally
penciled for 2.5 moves up: 2.4.0 ships ticket checklists *with templates*,
the admin console rework, and a setup experience someone half-asleep at 2am
can finish. Boilerplating is **static list management — no AI anywhere in
the feature**.

---

## Part 1 — Checklists + templates (the headline)

Modeled on Autotask's checklist implementation: reusable lists managed
centrally, applied to a ticket in one action, each item independently
dated. Going for feature-complete, not novelty.

### Data model

- `ChecklistTemplate` — `id`, `name` (unique), `description?`, `active`
  (archive semantics like custom fields), timestamps, `createdBy`.
- `ChecklistTemplateItem` — `id`, `templateId` (FK, cascade), `text`
  (varchar 500), `sortOrder`, `dueOffsetMinutes?` (nullable relative
  deadline: item dueAt = application time + offset; templates can't hold
  absolute dates).
- `ChecklistItem` (on tickets) — `id`, `ticketId` (FK, indexed), `text`,
  `done`, `doneBy?`/`doneAt?` (attribution), `dueAt?` (**independent
  per-item deadline**, indexed), `sortOrder`, `templateId?` (provenance),
  timestamps.

Real tables, not jsonb: items need audit records, reorder, live updates,
and per-item deadline queries.

### Behavior

- **Apply a template** → instantiates its items onto the ticket in order,
  computing each item's `dueAt` from its offset (unset offset = no
  deadline). Multiple templates may be applied to one ticket; manual items
  mix freely. Applying is audited as one action with per-item detail.
- **Item deadlines are independent** of the ticket's `dueAt`/SLA clocks —
  they render on the item row (overdue = error color), never in SlaChip.
  A later release can roll "earliest open item deadline" up to cards.
- Toggle/edit/delete/reorder audited via `auditRepository.record()` and
  published on `eventBus` (`ticket.updated` + `checklist` change tag) so
  open modals, lists, and other viewers live-update.
- Deleting a template never touches instantiated items (they're copies).

### Surfaces

- **REST**: `GET/POST /checklist-templates` (+`PATCH/DELETE /:id`, admin
  for mutation, technician read); `GET/POST /tickets/:id/checklist`,
  `PATCH/DELETE /tickets/:id/checklist/:itemId`,
  `POST /tickets/:id/checklist/apply-template` (`{ templateId }`).
- **MCP**: `list_checklist_templates`, `apply_checklist_template`,
  `add_checklist_item`, `toggle_checklist_item`; items included in
  `get_ticket` so agents can work a runbook top to bottom.
- **TicketDialog**: checklist section between description and activity —
  template selector + apply, add-item field, checkbox rows with
  strikethrough, per-item due chip with a phone-safe date editor, drag
  reorder, "3 of 5" progress line.
- **Admin → Checklists**: template CRUD with inline item editing and
  reorder — built *on the new admin scaffold* (below), so it lands as the
  reference implementation for the rework.
- **Verification**: mock-api template + item data, capture-script states
  across the five-device matrix, phone-width fullScreen guard extended to
  the checklist section (docs/mobile.md makes this mandatory).

### Later (explicitly out of 2.4.0)

- Automation condition `checklistComplete` / action `apply_checklist`.
- Checklist progress chips on cards/board/table.
- Per-item assignees.

---

## Part 2 — Admin console rework (moved up from 2.5)

Diagnosis (from the 2026-07-16 review): 1,879-line monolith, 15 sections,
no URL routing, no search/paging (Devices silently truncates at 200),
`window.confirm` × 3, automation editor is raw JSON textareas, and the
console resists code-splitting (1.78 MB main chunk).

Target: intuitive, powerful, testable, clicky — nothing an end user would
cry about.

1. **Split the monolith** into `components/admin/`, one panel per file,
   plus a shared `AdminCrudPanel` scaffold (header, quick-filter, table,
   editor dialog, feedback, empty state, confirm dialog). Checklist
   templates (Part 1) ship on this scaffold first; existing panels migrate
   behind it.
2. **URL-first navigation** — `/admin/:section` routes, grouped rail
   (*People & Access · Ticketing · Channels & Integrations ·
   Infrastructure*), breadcrumbs, browser back working, deep links from
   Overview cards and docs. Fold SyncView's provider CRUD into Admin so
   configuration lives in one console.
3. **Visual automation builder** — condition rows with field/op/value
   pickers driven by the backend's validated vocabulary (including
   `dueAt`/`effectiveDueAt` and `custom.<key>`), action rows with real
   team/user/label autocompletes, JSON demoted to an Advanced toggle.
   Backend: `POST /automations/preview` dry-run ("would have matched N
   tickets this week").
4. **Tables that scale** — quick-filter on every panel now; server
   search/paging on Devices (the one that truncates) using the ticket
   list's `{ items, total, page, pageSize }` shape.
5. **Consistency sweep** — shared `ConfirmDialog` everywhere destructive,
   one feedback pattern (saving → saved/failed, like the ticket modal),
   distinct Mailboxes vs Mail Identities icons with one-line captions,
   fix the Overview "Open tickets" dead link, `React.lazy` the console
   out of the main bundle.
6. **Testable** — the scaffold gets component tests (render, filter,
   destructive-confirm flow); the automation builder gets unit tests
   mapping UI state ⇄ rule JSON both directions; admin sections join the
   mobile capture matrix.

## Part 3 — 2am-proof setup

Someone half-asleep must get from `git clone` to a working desk without
reading source:

1. **First-run wizard** (backend-driven, shows when the users table is
   empty): create admin → confirm MFA choice → name the internal company →
   optional SMTP/IMAP test-connection step with real error text → done.
   Each step is skippable; state derives from the DB, never a flag file.
2. **Guided empty states** on every admin panel — explain the concept,
   offer the first action ("No SLA policies — create a default 4h/3d
   policy"), link the matching docs section.
3. **Connection self-checks** — every integration card gets a "Test"
   button that reports the *actual* failure (DNS, auth, TLS, permission)
   instead of a generic error; `/rmm/status` already models this.
4. **Docs pass** — a single ordered setup guide on the documentation hub
   (compose → login → wizard → first mailbox → first RMM), each step with
   a copy button and a "what you should see" screenshot from the capture
   harness; troubleshooting table for the ten most likely 2am mistakes.

---

## Sequencing

1. Checklist schema + repo + REST + MCP (backend lands first, testable).
2. Admin scaffold + routed nav → Checklists admin panel on it.
3. TicketDialog checklist section + mobile matrix.
4. Panel migrations + consistency sweep + automation builder.
5. First-run wizard + empty states + docs pass.

Cut-lines if 2.4.0 needs to shrink: the automation builder (3→2.5-era
follow-up) and the Devices server paging can trail; checklists + scaffold +
wizard are the release.
