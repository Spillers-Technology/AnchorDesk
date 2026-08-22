# AnchorDesk 1.11.0 — Shipshape

A tidy-up of the ticket workspace navigation. No new feature surface to learn —
the same tools, arranged so the primary ones are front and centre and the
redundant doors are gone.

## Changed

- **Board-first.** Kanban is now the default view, and the view switcher leads
  with **Board → Cards**. The board is where day-to-day work happens, so that's
  where you land.
- **The board fits the page.** Kanban columns flex to share the available width
  (with a 240px floor), falling back to horizontal scroll only when there are
  too many statuses to fit. Previously fixed 290px columns always pushed the
  board into a sideways scroll.
- **One Sync surface.** The top-level **Sync** view is the single home for sync
  providers, runs, and the activity log. Configuration (adding, removing, or
  enabling a provider) is gated to admins right where it lives; technicians can
  still view activity and trigger runs. The duplicate **Admin → "Sync
  Providers"** tab — a strict subset of the Sync view — has been removed.

## Added

- **Admin → Interface.** A new settings section for interface preferences, with
  a **Legacy table view** toggle. It's backed by a shared `ui` settings row that
  any signed-in user can read (`GET /ui-settings`) and only admins can change
  (`PATCH /ui-settings`).

## Upgrade notes

- **No schema changes** — the `ui` preference uses the existing settings table
  and is seeded automatically on first boot. Drop-in from 1.10.x.
- **The table view is now hidden by default.** It's the older DataGrid view, kept
  as an opt-in "legacy" option. If your team relies on it, an admin can switch it
  back on under **Admin → Interface**; Board and Cards are the primary views.
- **MCP / token integrations are unaffected** by this release.

## Validation

- Backend: 63 tests passed; TypeScript build passed.
- Web: 3 tests passed; TypeScript and Vite production build passed.

## Images

- `ghcr.io/spilloid/anchordesk-backend:1.11.0`
- `ghcr.io/spilloid/anchordesk-web-client:1.11.0`
