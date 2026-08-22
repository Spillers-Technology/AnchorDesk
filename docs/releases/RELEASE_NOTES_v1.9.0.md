# AnchorDesk 1.9.0 — Thread & Signal

AnchorDesk 1.9.0 makes ticket identity dependable across every surface and brings external-system state closer to the technician working the ticket.

## Highlights

- Human-friendly public ticket numbers are generated independently of database row IDs and displayed consistently in cards, tables, Kanban, dialogs, search, and printable exports.
- Outbound email subjects include `[#NNNNN]`; inbound IMAP can use that token to recover threading when `References` or `In-Reply-To` headers are stripped.
- Message-ID columns are widened to 255 characters, and bounded email/ticket fields are clamped before persistence.
- Invalid ticket and note route IDs return a clean HTTP 400 instead of reaching Prisma as `NaN`.
- Sync providers can be created, enabled, run, and deleted from the Sync view.
- Sync provenance badges appear consistently across card, table, Kanban, and ticket views.
- Linked Tactical RMM devices show live status, addresses, OS, site, hardware, and last-seen details when a ticket opens.
- Integration configuration is seeded from environment variables and deployment secrets support SOPS.

## Database notes

- `Ticket.externalId`, `Note.externalId`, `Note.inReplyTo`, `SyncLog.externalId`, and `Device.externalId` are now `varchar(255)`.
- A PostgreSQL sequence supplies generated public ticket numbers, beginning at the configured digit width.
- Fresh deployments apply the Prisma schema before starting the backend.

## Validation

- Backend: 57 tests passed; TypeScript build and Prisma validation passed.
- Web: 3 tests passed; TypeScript and Vite production build passed.
- Fresh Docker Compose rebuild: PostgreSQL, backend, web client, and Adminer healthy.
- Smoke-tested public numbering, invalid-ID guards, export numbering, provider CRUD, live-device guards, and nginx API proxying.

## Images

- `ghcr.io/spilloid/anchordesk-backend:1.9.0`
- `ghcr.io/spilloid/anchordesk-web-client:1.9.0`
