# AnchorDesk 2.0.0 — Signal & Spectrum (major)

AnchorDesk 2.0 is the feature-completion and usability release produced from a designer-grade pass over the full running application. It strengthens the two things a helpdesk has to communicate all day: **what needs attention** and **what is connected to what**.

## Personal workspaces

- Account → **Appearance** offers seven complete MUI palettes: Default Light, Default Dark, Solarized Light, Solarized Dark, Nord, Gruvbox, and Dracula.
- The selection applies without a reload, is stored as `User.themePref`, and is mirrored to local storage so the chosen palette appears before `/auth/me` resolves on the next load.
- Shared component geometry and typography stay consistent between palettes; semantic success/warning/error color remains distinct from the accent.

## Tickets arrive complete

- The repository now guarantees a real company link for every newly created ticket.
- Explicit company ids and names are honored; named sync records are promoted into Company rows; unclassified/API work falls back to `INTERNAL_COMPANY_NAME` (`SpillersTech` by default).
- New IMAP tickets match an existing company domain or create a readable company record from the sender domain.
- The existing repository-level `Medium` priority default remains the single guarantee for every ingest channel.

## Faster customer communication

- Company pages support inline contact editing and a clear make-primary action.
- Primary selection is atomic on the backend, so a company cannot retain two primary contacts after concurrent UI calls.
- A fresh ticket email chooses the linked contact first, then the company's primary contact, then its first emailable contact.

## Clear workflow signals

- Status uses semantic colored dots; priority uses directional/urgent icons. Both appear consistently in cards, the table, create/edit selectors, and bulk update.
- The ticket modal no longer repeats status and priority in both its header and detail controls.
- Internal notes, time entries, inbound mail, and outbound mail sit on one chronological activity rail.
- Narrow Kanban boards keep readable 280px columns and scroll horizontally; wide boards retain the fluid full-width layout.

## Network intelligence and map

- Device writes are enriched non-destructively: a missing vendor can be resolved from MAC/OUI, and a missing device type can be classified from ports, vendor, and hostname.
- The compressed OUI snapshot contains roughly 39,000 IEEE prefixes and loads only on the first fallback lookup. Curated display-friendly names win for common vendors.
- Known ports carry service names such as HTTPS, SMB, RDP, RTSP, MQTT, IPP, and JetDirect.
- The new Canvas map groups devices by operational category around the selected network, supports wheel zoom, pointer pan, hover tooltip, click selection, legend filtering, and double-click reset, and honors reduced-motion preferences.
- Company and probe filters remain; selecting a node still surfaces tickets linked to that device.

## Upgrade

```bash
git pull
cd backend
npm install
npx prisma db push
cd ../web-client
npm install
```

Then rebuild/restart your normal deployment. No new npm dependency was introduced.

Container tags for the release:

- `ghcr.io/spillers-technology/anchordesk-backend:2.0.0`
- `ghcr.io/spillers-technology/anchordesk-web-client:2.0.0`

## Verification target

- Backend: TypeScript build and Jest suite.
- Web client: TypeScript build, Vitest suite, and production Vite build.
- Schema: `prisma validate` and an additive `prisma db push` for `theme_pref`.
