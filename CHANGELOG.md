# Changelog

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
