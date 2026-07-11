# AnchorDesk 1.18.0 — Even Keel (minor)

A UX quick-win pass drawn from a full designer-grade audit of the running app.
Two themes: **tickets now arrive complete** (a null priority no longer slips
through the non-dialog ingestion paths), and the **first-impression edges are
polished** — the login screen, the app-bar, the nav drawer, and a couple of
data-dependent bugs that only surfaced with real data in the database.

## Added

- **Default priority enforcement (`backend/src/repositories/ticketRepository.ts`).**
  `create()` now applies a `Medium` default when no priority is supplied, so tickets
  from **inbound email, the REST API, MCP, and sync** are never persisted with a
  null priority. Previously only the New-ticket dialog defaulted, so everything else
  landed with a blank priority chip that read as "unset". Fixing it at the repository
  seam covers every path at once.

## Fixed

- **Sync activity log 500 (`backend/src/routes/sync.ts`).** `GET /sync/log` failed
  with `500 "Do not know how to serialize a BigInt"` whenever any log rows existed —
  `SyncLog.id` is a `BigInt`, which the JSON serializer can't encode. The Sync view
  swallowed the error and displayed "No sync activity yet", making a real history
  indistinguishable from none. The id is now mapped to a `Number` before send.
- **New-ticket dialog label overlap (`web-client/src/components/CreateTicketDialog.tsx`).**
  The Contact and Assignee selects use `displayEmpty`, so their `InputLabel` never
  detected a value to shrink against and rendered on top of it ("Nontact",
  "Unassigneed"). The labels are now forced to shrink (with a notched outline).
- **Login screen pinned to the top-left (`web-client/src/index.css`,
  `web-client/src/auth/LoginView.tsx`).** The sign-in card sat in the top-left corner
  with no branding. Root cause was the leftover Vite-starter
  `body { display:flex; place-items:center }` — in a flex body `place-items:center`
  only centers the cross axis, so `#root` was pinned to the left app-wide. The body is
  now a plain full-width block, `#root` fills the viewport, and the card is centered
  with the anchor mark, wordmark, and a "Local-first ticketing" tagline.
- **Companies list DOM-nesting warning (`web-client/src/components/CompaniesView.tsx`).**
  A `Chip` nested inside a `<p>` (a `Typography` in the contact list) triggered a
  `validateDOMNesting` console warning; the `Typography` now renders as a flex `div`.

## Changed

- **Nav drawer Table item is gated on `legacyTableView`**
  (`web-client/src/components/DashboardDrawer.tsx`, `App.tsx`) to match the toolbar
  toggle — clicking Table with the flag off no longer bounced back to the board — and
  **Board** now leads the Tickets group.
- **App-bar** shows the view name alongside the anchor mark instead of the repetitive
  `Dashboard - …` prefix (`web-client/src/components/DashboardAppBar.tsx`).
- **Docs capture harness (`docs/scripts/capture-product-media.mjs`).** Adds a
  **Companies** screenshot, accepts `playwright-core` and a `PLAYWRIGHT_CHANNEL`
  (drive an installed Edge/Chrome with no bundled-Chromium download), and is now
  documented for regeneration in `docs/scripts/README.md`.
- Backend and web-client package versions are now `1.18.0`.

## Notes

- **No schema change.**
- Scoped from the same audit and tracked for follow-up releases: enforcing a company
  on every ticket (with an internal fallback company) and auto-creating a company from
  an inbound sender's email domain; inline contact editing and choosing the primary
  contact; per-user theme personalization (light/dark/solarized and more); and a
  network-map node-label pass.
