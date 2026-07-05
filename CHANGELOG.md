# Changelog

## 1.17.0 — 2026-07-05 — Fair Copy (minor)

### Added

- **Rich-text ticket modal.** The ticket description renders as formatted HTML when markup is present (plain text is preserved otherwise) and edits through a shared rich-text editor with a visual/source-HTML toggle. The email composer shares the same editor and toggle.
- **Notes are a distinct rich composer, separate from email.** The activity card has its own rich note editor; saved notes become normal ticket notes with no mail configuration, recipients, or subject required. Editing an existing note now actually persists — the previous handler only logged to the console.
- **Bulk updates from the ticket views.** A write-capable user can select visible tickets from cards, table, or Kanban and set status, priority, and assignee in one operation. Selection is page/board-scoped (the currently loaded tickets), not "all matching this filter".
- **Unified contact picker.** The ticket modal's Contact field is now a searchable pick-or-create autocomplete matching the Company field, and the selected contact's email/phone is shown inline so you're not choosing blind.

### Changed

- Ticket descriptions and note HTML are sanitized server-side on save; list and card previews strip HTML to plain text; the printable ticket export renders sanitized formatted bodies instead of escaping raw tags.
- The Vite dev proxy now defaults `BACKEND_ORIGIN` to `http://localhost:8060` (host-local dev is the common path); set `BACKEND_ORIGIN=http://backend:8060` for containerized dev.

### Notes

- No schema change. The rich description still lives in the existing `tickets.description` text column; there is no separate versioned rich-text document model in this pass.
- Bulk selection is intentionally limited to the loaded page/board and does not include delete, merge, label, or free-text changes.

See [RELEASE_NOTES_v1.17.0.md](RELEASE_NOTES_v1.17.0.md) for the full release notes.

## 1.16.0 — 2026-07-05 — Trust Anchor (minor)

### Added

- **Built-in OAuth 2.0 authorization server for MCP.** AnchorDesk is now its own authorization server, so OAuth clients such as ChatGPT's custom connector complete the full authorization-code + PKCE flow against AnchorDesk itself — no external IdP required. It implements Dynamic Client Registration (RFC 7591) at `/oauth/register`, a session-gated consent screen at `/oauth/authorize` (an unauthenticated user is bounced to the AnchorDesk login and returned afterward), token exchange at `/oauth/token`, and authorization-server metadata at `/.well-known/oauth-authorization-server` (RFC 8414). The issued access token is a freshly minted personal access token scoped to the approving user, so RBAC and audit attribution are unchanged and the grant is revocable from **Account → API tokens**.

### Changed

- `/.well-known/oauth-protected-resource` now advertises **AnchorDesk itself** as the authorization server rather than the configured OIDC issuer. This is what lets ChatGPT register dynamically — a step most external IdPs don't allow — and keeps the resource and authorization servers on one origin, which is what MCP connectors expect. Delegating to an OIDC provider (the 1.15.0 approach) is no longer required or used for MCP.
- The production web proxy (nginx) and the Vite dev proxy now forward `/oauth/*` and `/.well-known/oauth-authorization-server` to the backend.

### Notes

- Schema change: two additive tables (`oauth_clients`, `oauth_auth_codes`). Run `prisma db push` (or `make db-push`) on upgrade.
- To connect ChatGPT, point its custom connector at `https://<your-app-base-url>/mcp/sse` — discovery, registration, and consent are automatic. OIDC no longer needs to be enabled for the MCP OAuth flow.

See [RELEASE_NOTES_v1.16.0.md](RELEASE_NOTES_v1.16.0.md) for the full release notes.

## 1.15.0 — 2026-07-05 — Connected Domains (minor)

### Added

- **OAuth-ready MCP for hosted custom domains.** AnchorDesk now publishes OAuth protected-resource metadata for `/mcp/sse`, adds MCP `WWW-Authenticate` discovery hints, and lets OAuth clients such as ChatGPT authenticate through the configured OIDC provider while PAT-based MCP clients keep working.
- **ChatGPT connector setup docs.** A new MCP auth guide covers callback URL setup, scopes, OAuth client fields, easier IdP reuse, and troubleshooting for hosted instances.

### Changed

- The production web proxy forwards `/.well-known/oauth-protected-resource` to the backend so custom-domain installs return JSON discovery instead of the app shell.

### Notes

- No schema change. OIDC must be enabled for OAuth clients; personal access tokens remain supported for clients that can send bearer headers.

See [RELEASE_NOTES_v1.15.0.md](RELEASE_NOTES_v1.15.0.md) for the full release notes.

## 1.14.0 — 2026-07-05 — Open Channels (minor)

> **Alpha:** the two integrations below are written against the vendors' published
> APIs but have **not yet been exercised against live tenants** (no credentials at
> release time). Treat RMM sync/scripts and two-way ticket sync as **experimental**
> — the seams are stable, but expect per-provider field mappings to need tuning
> once real accounts are connected.

### Added

- **NinjaOne and Datto RMM (alpha).** Device sync **and** script execution alongside Tactical RMM, behind a new **RMM registry** that maps a device source (`tactical_rmm` / `ninjaone` / `datto_rmm`) to an adapter bundling config-check + `DeviceProvider` + script catalogue + live snapshot. NinjaOne uses OAuth2 client-credentials and runs saved scripts by id; Datto uses the OAuth2 password grant and runs asynchronous **quick jobs** (queue a component UID, poll). Config is DB-backed in **Admin → Integrations**, with per-provider sync buttons and provenance badges.
- **Two-way ticket sync for ConnectWise Manage and Jira Cloud (alpha).** External tickets sync **both directions** and stay badged by sync state (`synced` / `pending` / `conflict` / `error`). A local edit pushes status/priority/assignee + notes back out; inbound pull still covers everything. **Conflict policy is flag-and-hold:** if both sides changed since the last sync, the ticket is flagged and auto-sync pauses until a human picks **keep local** or **keep remote**. New endpoints `POST /tickets/:id/sync` and `POST /tickets/:id/resolve-conflict`; a new **JiraProvider** (Jira Cloud v3, ADF bodies, status via transitions) joins the now-outbound-capable ConnectWiseProvider.

### Changed

- **CI/CD moved to the org's ARC runners and GitOps deploy.** After the repo moved to the `Spillers-Technology` org, CI targets the `arc-org` runner scale set (not the retired `self-hosted` label), the GHCR image path moved to the org namespace, and the compose-on-a-runner `CD.yml` was **removed** in favour of the GitOps/kustomize deploy flow.

### Notes

- New enum values require `prisma db push` on upgrade (see release notes).

See [RELEASE_NOTES_v1.14.0.md](RELEASE_NOTES_v1.14.0.md) for the full release notes.

## 1.13.0 — 2026-06-27 — Clear Deck (minor)

### Added

- **Advanced search with regex.** The ticket filter panel becomes an **Advanced search** with a case-insensitive **POSIX regular expression** field matched server-side across title, summary, description, company, ticket number, and priority — alongside the existing status / company / assignee / label facets and a new **include-closed** toggle. Invalid patterns are validated client-side and rejected with a clean **400** (Postgres `2201B`, unwrapped from Prisma's `P2010`) rather than a 500.
- **Fall-off close animation.** Each Kanban card has a hover **Close** action; closing plays a tip-and-drop animation as the card falls off the board.

### Changed

- **A board built for live work.** **"Closed" is no longer a Kanban column.** Closed tickets are hidden from the default working views (board, cards, table) and surfaced on demand via the advanced-search *include closed* toggle (a Closed column reappears only when closed tickets are actually loaded, so they're never orphaned). The board now **fills the page width** with no horizontal scrolling.
- **Denser ticket cockpit.** The ticket modal was tightened to stop wasting space: status + priority share one row, card padding is reduced, and every field (status, priority, contact, assignee, labels) uses a consistent floating-label control matching the company picker.
- **No flash on background refresh.** List views only blank to a spinner on the first load; live WebSocket updates, an optimistic close, and drag-between-columns now swap data in place instead of flashing the board out.

### Fixed

- **Duplicate / wedged IMAP ingest.** Email-to-ticket is now **idempotent on Message-ID**. The same message delivered to two monitored mailboxes (one Message-ID, two deliveries) or replayed on a re-poll no longer hits the `(external_id, external_provider)` unique index — which previously threw `P2002`, failed the whole poll, and wedged the mailbox on a "poison" message because `lastUid` never advanced. Duplicates are skipped (and counted in the poll log); a residual collision recovers by appending to the existing ticket.
- **Opaque IMAP errors.** A failed poll now surfaces ImapFlow's real reason (`responseText` / `serverResponseCode` / `authenticationFailed`) in the log and the mailbox's last error, instead of a bare `Command failed`.

See [RELEASE_NOTES_v1.13.0.md](RELEASE_NOTES_v1.13.0.md) for the full release notes.

## 1.12.0 — 2026-06-26 — Clockwork (minor)

### Added

- **My Day** — a per-tech day-spread of logged time (new **Time → My Day** nav). Windowed time entries sit on a vertical clock with overlap-aware lane packing; the unlogged spans between them render as labelled **gap bands** so holes in the day pop. Duration-only entries get a side tray and still count toward the total. Day nav, a live "now" line, and a logged-vs-gap summary; clicking a block opens the ticket. New endpoint `GET /me/time-entries` (client sends local day bounds so the day respects the tech's timezone).
- **Company-scoped device linking.** A ticket's "Link a device" picker is scoped to the ticket's company so another company's hardware can't be mis-associated; unassigned devices stay visible, with a **"show all companies (N hidden)"** escape hatch.
- **Network → company association.** Admin → Devices gains an inline **Company** column to assign/clear a device's company (via existing `PATCH /devices/:id`; no schema change).

### Fixed

- **Email-signature editor crash.** Account → Email signature crashed the page. The editor passed `editorProps: undefined` when no image-upload handler was supplied (the signature case); TipTap v3 builds the ProseMirror view from those props and dies on `dispatchTransaction`. The editor now always passes a props object. Also de-duplicated the `Link` extension (StarterKit v3 bundles it) and set `immediatelyRender: false`.

### Changed

- **Dev proxy host-friendly.** Vite dev proxy target is configurable via `BACKEND_ORIGIN` (defaults to the compose service name `backend`; set `http://localhost:8060` for host dev).

See [RELEASE_NOTES_v1.12.0.md](RELEASE_NOTES_v1.12.0.md) for the full release notes.

## 1.11.2 — 2026-06-26 — Polish (patch)

### Added

- **Integrations roadmap** in the Sync view — a presentational section showing what's live and what's next, badged honestly. Ticket sync (PSA): ConnectWise Manage (available), Autotask (coming soon). RMM sync: Tactical RMM (available), Datto RMM + ConnectWise Automate (coming soon). No change to existing functionality.
- **Version badge.** The running build version (from `package.json`, baked in at build time) now shows in the account menu — a one-glance answer to "did the deploy land?"

### Fixed

- **Stale UI after deploys.** The web server now sends `Cache-Control: no-store` for the app shell (`index.html`) while keeping fingerprinted `/assets/` cached immutably. New deploys are picked up immediately without a manual hard-refresh or CDN purge.

See [RELEASE_NOTES_v1.11.2.md](RELEASE_NOTES_v1.11.2.md) for the full release notes.

## 1.11.1 — 2026-06-24 — Switchboard (patch)

### Added

- **`internal` note type.** The `NoteType` enum gains `internal` for system/agent-generated internal notes — specifically the AVR phone-agent posting an end-of-call summary via `POST /api/tickets/:id/notes` with `noteType: "internal"`. Previously such a note 500'd on the enum. Internal notes render like standard notes for now.

### Notes

- Pairs with the AVR phone-agent integration, which authenticates as a technician-role service account using a personal access token (1.10.0). The `api` ticket source it uses was already valid.

See [RELEASE_NOTES_v1.11.1.md](RELEASE_NOTES_v1.11.1.md) for the full release notes.

## 1.11.0 — 2026-06-24 — Shipshape

A navigation/UX cleanup of the ticket workspace.

### Added

- **Admin → Interface** settings section with a **Legacy table view** toggle, backed by a new `ui` settings row. Read by any authenticated user (`GET /ui-settings`), written by admins (`PATCH /ui-settings`).

### Changed

- **Kanban is the default view**, and the view switcher leads with Board → Cards.
- **Kanban columns flex to fit the page width** (240px floor; horizontal scroll only when too many statuses to fit) instead of fixed-width columns that always overflowed.
- **Sync is one surface.** The top-level Sync view is the single home for providers, runs, and activity log. Config actions (add/remove/enable a provider) are gated to admins inline; everyone can view and trigger runs. The duplicate **Admin → "Sync Providers"** tab (a strict subset) was removed.
- **Table view is now opt-in "legacy"** — hidden from the switcher unless an admin enables it under Admin → Interface. Board and Cards are the primary views.

See [RELEASE_NOTES_v1.11.0.md](RELEASE_NOTES_v1.11.0.md) for the full release notes.

## 1.10.0 — 2026-06-23 — Keys & Trails

### Added

- **Personal access tokens.** Self-service API tokens (Account menu → API tokens) let programmatic clients that can't do an interactive or OIDC login — the MCP voice agent being the motivating case — authenticate *as a real user*. The raw `adk_…` token is shown once; only its SHA-256 hash is stored. Tokens carry the owner's role (RBAC unchanged), support optional expiry, and are revocable instantly. Minting is restricted to interactive logins; admins can revoke anyone's token.
- **Channel-tagged audit attribution.** Mutations now record the real user plus the channel they came through — `alice` (web), `alice (api)` (token REST), or `alice (mcp)` — so you can see *who* acted and *how*.

### Changed

- **MCP server requires authentication and attributes per user.** `/mcp/sse` is gated behind a personal access token (or session) and the server is built per-connection bound to that user. Send the token as `Authorization: Bearer <token>` (see `.mcp.json`).

### Fixed

- MCP mutations previously logged under a flat `'mcp'` actor regardless of who connected; they are now attributed to the authenticated user.

See [RELEASE_NOTES_v1.10.0.md](RELEASE_NOTES_v1.10.0.md) for the full release notes.

## 1.9.1 — 2026-06-21

### Added

- `AUTH_ADMIN_EMAILS` allowlist — emails listed here are granted the admin role on every OIDC/SAML login (promotion-only; non-listed users are never demoted).

### Fixed

- Inbound email subject threading no longer re-attaches on a bare `#NNNNN`. Only the bracketed `[#NNNNN]` tag we emit on outbound mail counts, so unrelated subjects ("Invoice #10042", "PO #12345") can't mis-thread a new email onto an existing ticket.

See [RELEASE_NOTES_v1.9.1.md](RELEASE_NOTES_v1.9.1.md) for the full release notes.

## 1.9.0 — 2026-06-21

### Added

- Configurable public ticket-number sequence and UI display across all ticket surfaces.
- Subject-based email threading fallback using `[#NNNNN]`.
- Sync provider create/delete management and reusable sync badges.
- Live Tactical RMM device details on ticket open.
- SOPS-managed integration deployment secrets.

### Changed

- Widened Message-ID-bearing columns to `varchar(255)`.
- Clamped bounded ticket, note, and IMAP values before database writes.
- Ticket exports now use public ticket numbers.
- Local Compose applies the Prisma schema before backend startup.

### Fixed

- Invalid ticket/note route IDs now return HTTP 400 instead of passing `NaN` to Prisma.
- Web container health checks now use IPv4 loopback.

See [RELEASE_NOTES_v1.9.0.md](RELEASE_NOTES_v1.9.0.md) for the full release notes.
