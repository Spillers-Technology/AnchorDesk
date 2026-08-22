# AnchorDesk 1.12.0 — Clockwork (minor)

The first slice of the **TIME** work lands — a day-spread that makes *unlogged*
time obvious — alongside company-scoped device linking and a real fix for the
email-signature editor crash.

## Added

- **My Day** — a per-tech day-spread of logged time (new **Time → My Day** nav).
  Time entries with a start/stop window sit on a vertical clock with
  overlap-aware lane packing; the spans between them render as labelled **gap
  bands** so holes in the day pop at a glance — the differentiator over a plain
  calendar. Duration-only entries (logged without a window) get a side tray and
  still count toward the day's total. Day navigation, a live "now" line on
  today, and a summary of logged vs. gap time. Clicking a block opens the ticket.
  - New endpoint `GET /me/time-entries` returns the signed-in user's entries for
    a day plus a summary; the client sends its own local day bounds so the day
    respects the tech's timezone.

- **Company-scoped device linking.** On a ticket with a company, the
  "Link a device" picker is now scoped to that company's hardware so another
  company's devices can't be mis-associated. Unassigned devices (no company)
  stay visible — ambiguous, not wrong — and a **"show all companies (N hidden)"**
  toggle is always there as an escape hatch.

- **Network → company association.** Admin → Devices gains an inline **Company**
  column to assign or clear a device's company (mirrors the probe panel), so the
  scoping above has data to work with. Backed by the existing
  `PATCH /devices/:id` — no schema change.

## Fixed

- **Email-signature editor crash ("DOM explodes").** Opening Account →
  **Email signature** crashed the page. Root cause: the editor passed
  `editorProps: undefined` when no image-upload handler was supplied (the
  signature case), and TipTap v3 builds the ProseMirror view from those props
  and dies on `dispatchTransaction`. The email composer only worked because it
  passed an upload handler (a props object). The editor now always passes a
  props object. Also de-duplicated the bundled vs. separately-registered `Link`
  extension (StarterKit v3 now bundles it) and set `immediatelyRender: false`
  for React 18.

## Changed

- **Dev proxy is host-friendly.** The Vite dev proxy target is now configurable
  via `BACKEND_ORIGIN` (defaults to the compose service name `backend`, so
  Docker is unchanged). Set `BACKEND_ORIGIN=http://localhost:8060` to run the
  dev server on the host against a containerised backend.

## Upgrade notes

- No schema changes. Drop-in from 1.11.x. `prisma db push` is a no-op.

## Validation

- Backend: 63 tests passed; TypeScript build passed.
- Web: 3 tests passed; TypeScript and Vite production build passed.
- Live smoke test (headless Edge against the local stack): signature dialog
  opens and the editor mounts with **0 console errors**; My Day renders the
  spread, gap band, and summary; the device picker correctly hides another
  company's device and offers the "show all" escape hatch.

## Images

- `ghcr.io/spilloid/anchordesk-backend:1.12.0`
- `ghcr.io/spilloid/anchordesk-web-client:1.12.0`
