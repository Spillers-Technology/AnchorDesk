# Admin console rework — target 2.5 ("Console & Keel")

Status: **planned** (2026-07-16). Some items may be expedited into 2.3/2.4 point
releases; the ticket-checklist feature below is the standing 2.4.0 candidate.

## Where the admin console stands today

`web-client/src/components/AdminView.tsx` is a single 1,879-line file holding
15 sections behind a left-rail nav (a horizontal scroll strip on phones). It
works, and the per-panel `useAsync` + editor-dialog pattern is consistent
enough to maintain — but it has accumulated seams:

1. **No URL routing.** The active section is component state, so there is no
   deep-linking (`/admin/automations`), refresh resets to Overview, and the
   browser back button leaves the console entirely — despite React Router 7
   already being installed.
2. **No search, filter, or paging in any admin list.** Every panel loads the
   full table; Devices hard-codes `pageSize: 200` and silently truncates
   beyond it. Users/Labels/Teams are fine at MSP scale today but degrade
   quietly.
3. **The automation editor is raw JSON.** Conditions and actions are typed by
   hand into monospace textareas, validated only on save, with reference IDs
   (teams/users/labels) presented as prose to copy from. This is the single
   biggest usability cliff in the product — the feature is powerful and the
   surface hides it.
4. **Inconsistent destructive-action handling.** Three panels use native
   `window.confirm`; others use MUI dialogs or nothing. Feedback is a mix of
   inline Alerts, dialog errors, and silent reloads.
5. **Monolith cost.** The file resists code-splitting (the production bundle
   is 1.78 MB / 538 KB gzip and Vite warns on it) and every panel edit churns
   the same file.
6. **Small potholes.** The Overview "Open tickets" stat card navigates to
   Overview (a no-op); Mailboxes and Mail Identities share the same icon and
   adjacent names with no explanation of the split; Sync provider management
   lives outside Admin in the Sync view, so "configuration" spans two places.

## Today-size lifts (safe for a 2.2.x/2.3 point release)

Each of these is an afternoon or less, independently shippable:

- **Route the sections.** `/admin/:section` with the existing rail as links;
  default redirect to overview. Unlocks deep links from docs, notifications,
  and the Overview cards. (Small)
- **Shared `ConfirmDialog`.** Replace the three `window.confirm` calls and
  adopt it as the standard for destructive actions console-wide. (Small)
- **Client-side quick-filter boxes** on Users, Devices, Labels, Teams, and
  Audit tables — a `TextField` filtering the loaded rows is a 10-line pattern
  and removes the worst of the scrolling. True server paging can wait for the
  rework. (Small)
- **Fix the Overview "Open tickets" card** to navigate to the ticket list
  (it currently points at Overview itself). (Tiny)
- **Distinct icon + one-line captions** for Mailboxes vs Mail Identities
  ("where mail arrives" vs "who mail sends as"). (Tiny)
- **`React.lazy` the admin console** out of the main bundle. Fastest possible
  win against the 1.78 MB chunk since admin is role-gated anyway. (Small)

## The 2.5 rework

Theme: the admin console becomes a first-class *application area* with the
same craft as the ticket views, not a settings drawer.

1. **Split the monolith.** `components/admin/` with one file per panel plus a
   shared `AdminCrudPanel` scaffold (header, search, table, editor dialog,
   feedback, empty state). Most panels become declarative configurations of
   the scaffold. This is the enabling move for everything below.
2. **URL-first navigation** with breadcrumbs and a console-wide "jump to
   setting" search (fuzzy over section names + field labels). Sections group
   into four headings that match how admins think: *People & Access* (Users,
   Authentication, Teams), *Ticketing* (SLA, Labels, Custom Fields,
   Automations, Views), *Channels & Integrations* (Mailboxes, Mail
   Identities, Integrations, Sync providers — folding SyncView's provider
   CRUD into Admin), *Infrastructure* (Probes, Devices, Audit).
3. **Visual automation builder** — the flagship. Condition rows with
   field/op/value pickers driven by the same vocabulary the backend
   validates (`BUILTIN_FIELDS`, `custom.<key>`, `dueAt`/`effectiveDueAt`,
   SLA `kind`/`level`), action rows with real team/user/label autocompletes
   instead of copy-the-ID prose, live rule preview ("would have matched N
   tickets this week" via a dry-run endpoint), and the JSON editor demoted to
   an Advanced toggle so nothing regresses. Backend addition: a
   `POST /automations/preview` dry-run endpoint.
4. **Server-driven admin tables.** Devices first (it already truncates):
   search + paging params on the admin list endpoints, reusing the ticket
   list's `{ items, total, page, pageSize }` shape.
5. **Guided empty states.** Each panel's zero-state explains the concept and
   offers the first action ("No SLA policies — create a default 4h/3d
   policy"), turning the console into its own onboarding.
6. **Mobile pass per the 360px rule.** The rail becomes a proper drawer at
   `xs`, every editor dialog is verified `fullScreen`, and the five-device
   capture matrix gains the admin sections it doesn't already cover.

Sequencing: 1 → 2 land together (mechanical, low risk); 3 is the headline and
can trail; 4–6 slot independently. If 2.5 needs to shrink, cut 4 and 5 before
3 — the automation builder is the reason to do this release.

## Ticket checklists — standing 2.4.0 candidate (expedite on demand)

Checklists on the ticket modal (subtask lists a technician works through).
Deferred from the 2.2.x batch because doing it right touches every layer;
spec so it's ready to lift:

- **Schema**: `ChecklistItem` model — `id`, `ticketId` (FK, indexed),
  `text` (varchar 500), `done` (bool), `doneBy`/`doneAt` (nullable
  attribution), `sortOrder`, timestamps. A real table (not jsonb) so items
  audit, reorder, and stream like notes do.
- **Repository**: `checklistRepository` with `auditRepository.record()` on
  every mutation and `eventBus` publishes (`ticket.updated` with a
  `checklist` change tag) so open modals and boards live-update.
- **REST**: `GET/POST /tickets/:id/checklist`,
  `PATCH/DELETE /tickets/:id/checklist/:itemId` (edit/toggle/reorder via
  PATCH), normal RBAC (readonly can't mutate).
- **MCP**: `add_checklist_item` / `toggle_checklist_item` tools; items
  included in `get_ticket` output so agents can work a runbook.
- **UI**: a TicketDialog section between description and activity — add
  field, checkbox rows with strikethrough, drag reorder, progress line
  ("3 of 5"); optional later: progress chip on cards/table.
- **Verification**: mock-api checklist data, capture-script states for the
  five-device matrix, and the phone-width fullScreen guard extended to the
  checklist section — per docs/mobile.md this is required, not optional.
- **Automation follow-up** (post-MVP): `checklistComplete` condition field
  so rules can gate status changes on a finished list.

Estimate: one focused day including the mobile matrix. Nothing in it blocks
on the 2.5 rework, so it can ship as 2.4.0 whenever prioritized.
