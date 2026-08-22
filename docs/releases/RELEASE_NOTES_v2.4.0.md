# AnchorDesk 2.4.0 — Checklist & Console (minor)

Checklist & Console makes recurring work repeatable and the admin console a
place you'd actually send someone: reusable checklist templates with
per-item deadlines, a visual automation builder with dry-run previews, a
first-run setup wizard, and an upgrade path that heals data on boot.
Node.js 22.12+ and the local-first PostgreSQL model are unchanged.

## Checklists with templates

- **Admin → Checklists** manages reusable boilerplate lists ("New user
  onboarding", "Workstation offboarding"). Template items carry a relative
  due offset — minutes after the template is applied — because templates
  can't hold absolute dates.
- **Applying a template copies its items** onto the ticket in order,
  computing each item's own deadline from its offset. Template edits and
  deletions never touch checklists already on tickets.
- Items toggle with who/when attribution, show overdue-red deadline chips
  with a phone-safe date editor, and live-update every open view. A ticket
  can mix several templates plus ad-hoc items; a progress bar tracks
  "N of M".
- **Item deadlines are independent** — they never feed the ticket's SLA or
  manual clocks.
- REST: `GET/POST/PATCH/DELETE /checklist-templates*` (admin mutation),
  `GET/POST/PATCH/DELETE /tickets/:id/checklist*`, and
  `POST /tickets/:id/checklist/apply-template`.
- MCP: `list_checklist_templates`, `apply_checklist_template`,
  `add_checklist_item`, `toggle_checklist_item`; `get_ticket` now includes
  the checklist so agents can work a runbook top to bottom.

## Admin console rework

- **Deep-linkable sections** — the active section lives in the `?admin=`
  query param: refresh keeps your place, the back button works, and links
  land people exactly where you point them.
- The rail groups sections under *People & Access · Ticketing · Channels &
  Integrations · Infrastructure*; the console lazy-loads out of the main
  bundle.
- **The automation editor is visual now**: condition and action rows with
  real team/user/label pickers, priority and SLA menus, and datetime hints —
  built on the exact vocabulary the backend validates. **Preview matches**
  dry-runs your conditions against the last 7 days of tickets
  (`POST /automations/preview`) before you save. Raw JSON remains one
  Advanced toggle away.
- Consequence-explaining confirm dialogs replace every `window.confirm`;
  Users, Devices, and Audit tables gained quick filters; empty states
  explain what each concept is for and what to do first.

## First run and upgrades

- **Setup wizard** — a fresh instance's login screen offers to create the
  initial admin (password-confirmed, then straight into the normal
  sign-in + MFA enrollment flow). The endpoints are gated by the users
  table being empty and seal themselves the moment any account exists.
- **Boot-time data migrations** — the backend now runs idempotent data
  fixes on every start, the data counterpart to the schema push the
  containers already run. 2.4.0 ships the first: normalizing
  out-of-vocabulary ticket statuses/priorities (see below).
- **`docs/upgrading.md`** documents the pull-restart-done procedure and
  per-version notes back to 1.x.

## Vocabulary enforcement (the "open" bug)

The MCP tooling historically suggested filtering by a fictional `"Open"`
status and defaulted new-ticket priority to the legacy numeric `'3'` —
minting tickets invisible to every board column, status filter, and SLA
policy match. The backend now owns the canonical vocabulary
(`New/Assigned/In Progress/Waiting/Resolved/Closed`,
`Low/Medium/High/Critical`): REST and MCP writes canonicalize
case-insensitively and reject unknowns naming the valid list; the MCP tool
descriptions teach the real statuses; existing stray rows are healed
automatically by the boot data migration. External provider sync keeps its
own status vocabularies untouched.

## Upgrade notes

- Schema changes are additive (three new checklist tables) and applied
  automatically by the standard schema push on start.
- The status/priority normalization runs automatically on first boot of
  2.4.0 — local tickets only; external tickets untouched.
- Nothing manual required from 2.3.0. Coming from 2.2.0, also read the
  2.3.0 note about automation `dueAt`/`effectiveDueAt` semantics.

## Images

- `ghcr.io/spillers-technology/anchordesk-backend:2.4.0`
- `ghcr.io/spillers-technology/anchordesk-web-client:2.4.0`

## Verification

- Backend: 32 suites / 238 tests (checklist apply/toggle contracts,
  vocabulary normalization, automation converters), `prisma validate`,
  `tsc` build.
- Web: production build, ESLint clean, 30 Vitest tests including checklist
  section behavior, automation draft⇄JSON converters, and the phone-width
  dialog guards.
