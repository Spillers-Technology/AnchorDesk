# AnchorDesk 1.11.2 — Polish (patch)

Small quality-of-life polish: a look at where integrations are headed, and two
fixes that make deployments legible.

## Added

- **Integrations roadmap.** The Sync view now ends with a roadmap of sync
  connectors — what's live and what's planned, badged honestly so nothing live
  is mislabeled. All targets are built on public/official APIs.
  - **Ticket sync (PSA):** ConnectWise Manage (available), Autotask (coming soon).
  - **RMM sync:** Tactical RMM (available), Datto RMM and ConnectWise Automate
    (coming soon).
  - Purely informational — no wiring, no change to existing providers.

- **Version badge.** The account menu shows the running build version (baked in
  from `package.json` at build time), so "is this the new build?" is answerable
  at a glance.

## Fixed

- **Stale UI after a deploy.** The web server now serves the app shell
  (`index.html`) with `Cache-Control: no-store`, while fingerprinted build assets
  under `/assets/` stay cached immutably. A new deploy is now picked up
  immediately — no manual hard-refresh or CDN purge to see the latest UI.
  - Note: if a CDN/Cloudflare "cache everything" rule is in front of the origin,
    honor or purge it as usual; the origin now signals correctly either way.

## Upgrade notes

- No schema or API changes. Drop-in from 1.11.x.

## Validation

- Backend: 63 tests passed; TypeScript build passed.
- Web: 3 tests passed; TypeScript and Vite production build passed.

## Images

- `ghcr.io/spilloid/anchordesk-backend:1.11.2`
- `ghcr.io/spilloid/anchordesk-web-client:1.11.2`
