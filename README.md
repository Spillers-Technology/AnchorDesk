<div align="center">

# AnchorDesk
<img width="1448" height="1086" alt="image" src="https://github.com/user-attachments/assets/3aecc3fd-67d6-43b8-b186-374ad0c0d3a2" />

**A local-first ticketing platform for MSPs and IT teams — that also sees and acts on the machines behind the tickets.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/spilloid/AnchorDesk?color=6750A4)](https://github.com/spilloid/AnchorDesk/releases)
[![Build images](https://github.com/spilloid/AnchorDesk/actions/workflows/publish-images.yml/badge.svg)](https://github.com/spilloid/AnchorDesk/actions/workflows/publish-images.yml)
[![Stack](https://img.shields.io/badge/stack-React%20·%20Fastify%20·%20Prisma%20·%20PostgreSQL-555.svg)](#architecture)

[**Website**](https://spilloid.github.io/AnchorDesk/) · [Quickstart](#quickstart) · [Architecture](#architecture) · [API](#api) · [Docs](docs/)

</div>

---

## What it is

**AnchorDesk** is a self-hosted ticketing system where your **local PostgreSQL database is the source of truth**. External platforms — ConnectWise Manage, IMAP mailboxes, network probes, and RMM tools — feed the local store without becoming a hard dependency. Run it standalone, then connect the pieces of your stack you actually use.

What sets it apart from a plain helpdesk: each ticket can become an operations cockpit. Link the **devices** involved, inspect their source and status, run RMM scripts, send email, and keep the resulting activity on the ticket. Core changes are recorded in an **append-only audit log** with actor and before/after data.

## What ships in v1.15.0

- **🤖 ChatGPT-ready MCP on hosted domains** — custom-domain AnchorDesk instances can now expose ticketing tools to OAuth clients such as ChatGPT. The MCP server publishes protected-resource metadata, trusts your configured OIDC provider, and keeps personal access tokens available for header-capable clients.
- **🧭 Connector setup guide** — new MCP auth docs walk through the easier IdP path, callback URL setup, scopes, OAuth fields, and troubleshooting.

**Also landed recently:** NinjaOne and Datto RMM plus two-way ConnectWise/Jira ticket sync (1.14), the page-filling **Clear Deck** board with regex advanced search and a denser cockpit (1.13), the **My Day** time day-spread and company-scoped device linking (1.12), and built-in **personal access tokens** for MCP/agent auth (1.10).

The core platform also includes:

- **✉️ Multi-identity email** — send as shared boxes (help@, support@) or a personal alias on your SMTP domain, with **Cc/Bcc**, contact **autocomplete**, per-tech **signatures**, reusable **boilerplate templates**, and paste/drop **inline images**. The From header uses the chosen identity while the SMTP envelope stays your relay so SPF/DKIM still pass. <sub>(Your relay must allow sending as the chosen From address — normal for same-domain aliases; if it enforces sender = auth-user it will reject and AnchorDesk surfaces a clear error.)</sub>
- **🏷️ Labels & mailbox tagging** — managed, colored labels on tickets; each IMAP mailbox can auto-apply a label so catchall vs help@ vs a personal inbox arrive tagged differently.
- **🖼️ Inline images** — images in emails and internal notes render inline (lazy-loaded, never overflowing the timeline); inbound inline images are captured as attachments.
- **🧾 Script logs on the ticket** — RMM script runs append their output to the ticket timeline (live).
- **⬇️ Download ticket** — export a ticket to a self-contained printable HTML document (activity + inline attachments) for Print → PDF.
- **🔎 Fuzzy search** — typo-tolerant Postgres `pg_trgm` search combined with full-text, reaching across priority, ticket number, and the conversation/timeline.
- **📎 Attachments** — drag-and-drop files onto a ticket or attach them to an outgoing email; inbound email attachments are captured automatically. Bytes live on local disk or any **S3-compatible** store (AWS S3, MinIO, Cloudflare R2, Backblaze B2), selectable by env var or in **Admin → Integrations**.
- **🔔 Live updates & notifications** — a WebSocket channel pushes ticket, note, and SLA changes in real time: lists, the Kanban board, and the open ticket update without a refresh, and a notification bell alerts you to assignments, customer replies, and SLA risk.
- **⏰ SLA tracking** — per-priority / per-company response & resolution targets with live countdown chips (green → amber → red) on lists, cards, the board, and the ticket; breaches and at-risk tickets raise notifications.
- **🎫 Local-first ticketing** — create and edit tickets, assign technicians, manage notes, filter views, and use card/table/Kanban layouts. The list is server-paginated with server-side search and filtering, so it scales past large ticket counts.
- **🧰 Ticket cockpit** — one ticket view with status, priority, source, company & contact, assignee picker, activity timeline, time tracking, linked devices, script jobs, and email.
- **🏢 Companies & contacts (CRM)** — first-class company and contact records, company pages, company-scoped tickets and devices, and inline contact creation from a ticket.
- **⏱️ Time tracking** — log billable time as a quick duration or a start/stop window; entries total per ticket and are editable on the timeline.
- **📥 Email-to-ticket** — poll one or more IMAP mailboxes, create tickets from new messages, and thread replies into existing tickets by `In-Reply-To` and `References`, preserving sanitized inbound HTML.
- **📤 Ticket email** — compose sanitized **HTML** replies from inside a ticket with a rich-text editor; outbound mail sets threading headers so customer replies land back on the same ticket, rendered as an inbound/outbound conversation on the timeline.
- **🧭 Admin console** — live ticket/device/probe/user/mailbox counts, recent activity, user and auth management, integration settings, mailbox management, inventory, and an audit-log viewer.
- **🔐 Auth + RBAC** — local accounts, OIDC, and SAML 2.0 can run side by side. TOTP MFA is required by default for local accounts, with `admin`, `technician`, and `readonly` roles.
- **🖥️ Device inventory + network map** — ingest devices from [netviz](#probes--devices), sync them from Tactical RMM, or add them manually; group the radial map by probe or company and link devices to tickets.
- **⚡ Tactical RMM actions** — sync devices, browse the Tactical script catalog, run scripts now or schedule them, and retain job status/output.
- **🔄 ConnectWise ingestion** — incrementally import ConnectWise Manage tickets and notes into the local database with provider status and sync logs. This is inbound sync, not two-way writeback.
- **📝 Audit history** — ticket, note, device, user, mailbox, and other managed-record changes append actor-attributed history; admins can browse recent events across entities.
- **🤖 MCP server** — built-in [Model Context Protocol](https://modelcontextprotocol.io) tools let authenticated agents list, read, create, and update tickets, add notes, log time, send ticket email, and inspect ticket history. Header-capable clients can use AnchorDesk personal access tokens; OAuth-capable clients such as ChatGPT can discover the configured OIDC issuer through protected-resource metadata.
- **📦 Self-hosting included** — Docker Compose, Kubernetes manifests, and tagged backend/web images on GHCR.

## Architecture

```text
web-client (React + MUI)
     │  /api/* + /mcp proxied to backend
     ▼
backend (Fastify + TypeScript)
     │  Prisma ORM · local/OIDC/SAML auth · RBAC · schedulers · MCP server
     ▼
PostgreSQL  ← source of truth (tickets, notes, audit, users, devices, mailboxes, script jobs)
     ▲
     │  adapters and pollers
     ├── ConnectWiseProvider   (inbound tickets + notes)
     ├── NetVizProvider        (probe → device ingest)
     ├── Tactical RMM          (device sync + script runner)
     └── IMAP / SMTP           (email-to-ticket + outbound mail)
```

Design patterns at the integration boundary:

- **Strategy** — `TicketProvider`, `DeviceProvider`, and `ScriptRunner` interfaces (`backend/src/providers/`, `backend/src/runners/`).
- **Repository** — `backend/src/repositories/` wraps Prisma queries for the application routes.
- **Append-only audit log** — repositories record managed-record changes with actor and before/after values.

See [docs/architecture.md](docs/architecture.md) for the full diagram and rationale.

## Quickstart

**Prerequisites:** Node.js 18+ and Docker with Compose.

Create a root `.env` for Compose:

```dotenv
DB_NAME=anchordesk
DB_USER=mtapp
DB_PASSWORD=change-me
```

Then start the database and configure the backend:

```bash
# PostgreSQL + Adminer DB browser (:8081)
docker compose up -d db adminer

# Backend configuration
cp backend/.env.example backend/.env
# Match DATABASE_URL to the Compose values above:
# postgresql://mtapp:change-me@localhost:5432/anchordesk
# For quick local development, set OIDC_DISABLED=true.
# For a real login, set AUTH_SESSION_SECRET, ENCRYPTION_KEY,
# and BOOTSTRAP_ADMIN_PASSWORD instead.

# Install dependencies and push the schema
cd backend
npm install
npx prisma db push
```

Run the backend and frontend in separate terminals:

```bash
cd backend && npm start                       # :8060
cd web-client && npm install && npm run dev   # :5173
```

Open **http://localhost:5173** — `/api/*`, `/probe/*`, and `/mcp/*` are proxied to the backend.

For the complete Compose stack, run `docker compose up --build`. Tagged release images are published as:

- `ghcr.io/spillers-technology/anchordesk-backend:1.15.0`
- `ghcr.io/spillers-technology/anchordesk-web-client:1.15.0`

## Configuration

See [backend/.env.example](backend/.env.example) for the complete backend configuration. Auth and integration environment variables seed the database; edits made later in the Admin UI take precedence.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://user:pass@host:5432/anchordesk` |
| `APP_BASE_URL` | Production | Public URL used to build OIDC/SAML callbacks |
| `AUTH_SESSION_SECRET` | Production | Signs session cookies (`openssl rand -hex 32`) |
| `ENCRYPTION_KEY` | Production | 64 hex characters used for AES-256-GCM encryption of stored mailbox passwords |
| `BOOTSTRAP_ADMIN_PASSWORD` | First boot | Creates the first local admin when the users table is empty |
| `MFA_REQUIRED` | Optional | TOTP MFA for local accounts — **on by default** |
| `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` | Optional | OIDC SSO (Azure AD, Authentik, Okta, and other compliant IdPs) |
| `SAML_ENTRY_POINT` / `SAML_IDP_CERT` | Optional | SAML 2.0 SSO |
| `OIDC_DISABLED` | Development only | Set `true` to bypass auth as the development admin |
| `CWM_*` | Optional | Seeds ConnectWise Manage credentials |
| `TRMM_*` | Optional | Seeds Tactical RMM device sync and script runner credentials |
| `SMTP_*` | Optional | Seeds outbound SMTP settings; IMAP mailboxes are created in Admin → Mailboxes |
| `TICKET_NUMBER_DIGITS` | Optional | Public ticket-number width, 4–6 (default 5) |

Auth methods can be configured after first boot from **Admin → Authentication**. SMTP, ConnectWise, and Tactical RMM can be managed from **Admin → Integrations**. Secrets are write-only in API responses.

## API

Local tickets are the source of truth. Integrations ingest into or act on those local records.

| Area | Routes |
|---|---|
| **Auth** | `POST /auth/login`, `/auth/mfa/*`, `/auth/oidc/*`, `/auth/saml/*`, `GET /auth/me`, `POST /auth/logout` |
| **Admin** | `/admin/overview`, `/admin/audit`, user CRUD, auth settings, integration settings, and mailbox CRUD/polling |
| **Tickets** | `GET/POST /tickets` (paginated `{ items, total, page, pageSize }`), `GET /tickets/search?q=`, `GET/PATCH/DELETE /tickets/:id`, ticket history, notes, and `/tickets/:id/time` |
| **Devices** | Device CRUD/history plus ticket link/unlink routes |
| **Probes** | `POST/PATCH /probes`, `POST /probe/heartbeat`, and `POST /probe/devices` |
| **Scripts** | Tactical catalog, device sync, immediate/scheduled jobs, and job history |
| **Mail** | SMTP status and `POST /tickets/:id/email`; IMAP polling is managed under `/mailboxes` |
| **Sync** | Provider list/status, inbound sync runs, and sync logs; legacy read-only `/cw/tickets/*` routes remain available |
| **MCP** | SSE transport at `/mcp/sse` with client messages at `/mcp/messages`; OAuth protected-resource metadata at `/.well-known/oauth-protected-resource` |
| **Health** | `GET /ping` → `pong` |

Probes authenticate with an `X-Probe-Key` API key and are exempt from browser auth. Other routes require a session cookie or OIDC bearer token unless `OIDC_DISABLED=true`. `readonly` users cannot mutate data, and sensitive administration and sync operations require the `admin` role.

### MCP authentication

AnchorDesk supports two MCP auth paths:

- **Personal access token:** use an MCP client that can send custom headers and point it at `/mcp/sse` with `Authorization: Bearer <token>`.
- **OAuth/OIDC:** configure OIDC in **Admin → Authentication**, then create or reuse an OAuth client in that IdP for ChatGPT. Add the callback URL shown by ChatGPT, use authorization-code + PKCE, and request `openid profile email`. ChatGPT discovers AnchorDesk's resource metadata from `/.well-known/oauth-protected-resource`, completes the OAuth flow with the IdP, and calls `/mcp/sse` with the issued bearer token.

See [docs/mcp-auth.md](docs/mcp-auth.md) for a step-by-step ChatGPT setup guide and troubleshooting notes.

## Probes & devices

A probe is a scanner deployed on a customer LAN that pushes discovered devices into AnchorDesk. The reference probe is [netviz](https://github.com/Spillers-Technology/netviz). An admin registers a probe from **Admin → Probes** (or `POST /probes`) and receives its API key once. A probe can be linked to a **company**, which then flows onto every device it discovers. The probe heartbeats and posts device records, which are upserted locally, displayed in the **Network** view, and available to link to tickets.

The wire contract lives in [backend/src/providers/NetVizProvider.ts](backend/src/providers/NetVizProvider.ts).

## Documentation

- [docs/architecture.md](docs/architecture.md) — patterns, request lifecycle, and auth
- [docs/mcp-auth.md](docs/mcp-auth.md) — MCP personal-token and OAuth/OIDC setup
- [docs/schema.md](docs/schema.md) — database schema
- [docs/providers.md](docs/providers.md) — adding a sync provider
- [CLAUDE.md](CLAUDE.md) — developer reference

## Contributing

Issues and PRs are welcome. New integrations should implement the relevant strategy interface and keep data access behind repositories; see [docs/providers.md](docs/providers.md).

## License

[MIT](LICENSE) © Joseph Spillers
