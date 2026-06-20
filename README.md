<div align="center">

# anchordesk
<img width="1448" height="1086" alt="image" src="https://github.com/user-attachments/assets/da07a6e2-6b5b-4eaf-8620-e1243ab60f4c" />

**A local-first ticketing platform for MSPs and IT teams — that also sees and acts on the machines behind the tickets.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/badge/release-v1.1.0-6750A4.svg)](https://github.com/spilloid/anchordesk/releases)
[![Build images](https://github.com/spilloid/anchordesk/actions/workflows/publish-images.yml/badge.svg)](https://github.com/spilloid/anchordesk/actions/workflows/publish-images.yml)
[![Stack](https://img.shields.io/badge/stack-React%20·%20Fastify%20·%20Prisma%20·%20PostgreSQL-555.svg)](#architecture)

[**Website**](https://spilloid.github.io/AnchorDesk/) · [Quickstart](#quickstart) · [Architecture](#architecture) · [API](#api) · [Docs](docs/)

</div>

---

## What it is

**anchordesk** is a self-hosted ticketing system where your **local PostgreSQL database is the source of truth**. External platforms — ConnectWise Manage, IMAP mailboxes, RMM tools — are *sync adapters* that feed into the local store, not the core. Run it completely standalone, or wire in as many integrations as you need; the product works the same either way.

What sets it apart from a plain helpdesk: tickets are linked to the **devices** they're about (discovered by network probes, visualized as a live network map) and you can **run scripts** against those devices through your RMM, all from the ticket. Every mutation — to a ticket, note, device, or probe — appends to an **append-only audit log**, giving you full revision history and attribution out of the box.

## Highlights

- **🎫 Local-first ticketing** — full CRUD, statuses, priorities, assignees, time entries, a Kanban board, and Postgres full-text search. No external dependency required.
- **🔐 Flexible auth + RBAC** — local accounts, OIDC SSO (Azure AD, Authentik, Okta…), and SAML 2.0 run side by side. **TOTP MFA on by default**, three roles (admin / technician / readonly) enforced on every route, all managed from the Admin UI or seeded from env.
- **📝 Full audit trail** — every change writes a before/after snapshot to an append-only log. Per-ticket history, who-changed-what, compliance-ready.
- **🖥️ Device inventory + Network map** — LAN probes (e.g. [netviz](#probes--devices)) push discovered devices; a **Network view** renders them as a radial map (online/offline, open ports), and you can link them to tickets.
- **⚡ Act on machines** — queue and schedule scripts against devices through your RMM (Tactical RMM today) directly from a ticket.
- **🔌 Pluggable sync** — a Strategy/Repository/Factory boundary makes ConnectWise, IMAP-to-ticket, and RMM runners drop-in. Adding one is a new class, not a rewrite.
- **🤖 MCP server** — a built-in [Model Context Protocol](https://modelcontextprotocol.io) endpoint lets agents like Claude Code read and manage tickets.
- **📦 Ship anywhere** — Docker Compose for local/production, Kubernetes manifests, and prebuilt images on GHCR.

## Architecture

```
web-client (React + MUI)
     │  /api/* + /mcp proxied to backend
     ▼
backend (Fastify + TypeScript)
     │  Prisma ORM   ·   auth (local/OIDC/SAML + sessions + RBAC)   ·   MCP server
     ▼
PostgreSQL  ← source of truth (tickets, notes, audit_log, users, sessions, devices, probes, script_jobs)
     ▲
     │  sync adapters (Strategy pattern)
     ├── ConnectWiseProvider   (CW Manage)
     ├── NetVizProvider        (probe → device ingest)
     ├── TacticalRmmProvider   (device sync + script runner)
     └── ImapProvider / mail   (email → ticket)
```

Design patterns at the integration boundary:

- **Strategy** — `TicketProvider`, `DeviceProvider`, and `ScriptRunner` interfaces (`backend/src/providers/`, `backend/src/runners/`).
- **Repository** — `backend/src/repositories/` wraps all Prisma queries; routes never touch Prisma directly.
- **Observer (append-only log)** — every mutation flows through `auditRepository.record()` before responding.

See [docs/architecture.md](docs/architecture.md) for the full diagram and rationale.

## Quickstart

**Prerequisites:** Node.js ≥ 18, Docker + Docker Compose.

```bash
# 1. Start the database (Postgres + Adminer DB browser on :8081)
docker compose up -d db adminer

# 2. Configure the backend
cp backend/.env.example backend/.env
# edit backend/.env — set DATABASE_URL and OIDC_DISABLED=true for local dev
# (for a real login: set AUTH_SESSION_SECRET + BOOTSTRAP_ADMIN_PASSWORD instead)

# 3. Push the schema
cd backend && npx prisma db push

# 4. Run backend + frontend (two terminals)
cd backend && npm install && npm start          # :8060
cd web-client && npm install && npm run dev      # :5173
```

Open **http://localhost:5173** — all `/api/*` requests proxy to the backend.

For a production-like full stack: `docker compose up --build`. Prebuilt images are published to GHCR on every tagged release (`ghcr.io/spilloid/anchordesk-backend`, `-web-client`).

## Configuration

Auth and integrations are driven by environment variables — see [backend/.env.example](backend/.env.example).

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://user:pass@host:5432/anchordesk` |
| `APP_BASE_URL` | Prod | Public URL — builds OIDC/SAML callbacks |
| `AUTH_SESSION_SECRET` | Prod | Signs session cookies (`openssl rand -hex 32`) |
| `BOOTSTRAP_ADMIN_PASSWORD` | First boot | Creates the first local admin when the users table is empty |
| `MFA_REQUIRED` | Optional | TOTP MFA for local accounts — **on by default** |
| `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` | Optional | OIDC SSO (Azure AD, Authentik, Okta…) |
| `SAML_ENTRY_POINT` / `SAML_IDP_CERT` | Optional | SAML 2.0 SSO |
| `OIDC_DISABLED` | Dev only | Set `true` to skip auth entirely (every request = dev admin) |
| `CWM_*` | Optional | ConnectWise Manage sync |
| `TRMM_*` | Optional | Tactical RMM device sync + script runner |
| `SMTP_* / IMAP_*` | Optional | Outbound mail / email-to-ticket |

Auth methods can also be configured **after first boot from Admin → Authentication** — env vars seed the initial config, the DB row wins afterward.

## API

Local tickets (the source of truth) live under `/tickets`; integrations are namespaced.

| Area | Routes |
|---|---|
| **Auth** | `POST /auth/login`, `/auth/mfa/*` (TOTP), `/auth/oidc/*`, `/auth/saml/*`, `GET /auth/me`, `POST /auth/logout` |
| **Admin** | `GET/POST/PATCH/DELETE /users`, `GET/PATCH /auth/settings` (admin role) |
| **Tickets** | `GET/POST /tickets`, `GET /tickets/search?q=` (full-text), `GET/PATCH/DELETE /tickets/:id`, `GET /tickets/:id/history`, notes under `/tickets/:id/notes` |
| **Devices** | `GET /devices`, `GET /devices/:id`, link/unlink to tickets |
| **Probes** | `POST /probes` (register, returns one-time API key), `POST /probe/heartbeat`, `POST /probe/devices` (ingest) |
| **Scripts** | queue / schedule script jobs against a device's RMM |
| **Mail** | inbound email → ticket, outbound notifications |
| **ConnectWise** | `/cw/tickets/*` passthrough |
| **MCP** | `/mcp` — Model Context Protocol server |
| **Health** | `GET /ping` → `pong` |

Probes authenticate with an `X-Probe-Key` API key and are auth-exempt; everything else requires a **session cookie** (browser login) or an **OIDC bearer token** (API clients), unless `OIDC_DISABLED`. Routes are gated by role: `readonly` can read but not mutate, and admin-only surfaces (users, auth settings, probes, sync) require the `admin` role.

## Probes & devices

A probe is a scanner deployed on a customer LAN that pushes discovered devices into anchordesk. The reference probe is [netviz](https://github.com/Spillers-Technology/netviz). An admin registers a probe (Admin → Probes, or `POST /probes`) and receives an API key once; the probe heartbeats and posts device records, which are upserted into the local `devices` table, rendered in the **Network** view, and can be linked to tickets. The wire contract lives in [backend/src/providers/NetVizProvider.ts](backend/src/providers/NetVizProvider.ts) (contract v1).

## Documentation

- [docs/architecture.md](docs/architecture.md) — patterns, request lifecycle, auth
- [docs/schema.md](docs/schema.md) — database schema
- [docs/providers.md](docs/providers.md) — how to add a sync provider
- [CLAUDE.md](CLAUDE.md) — full developer reference

## Contributing

Issues and PRs welcome. New sync integrations should implement the relevant Strategy interface and route all DB access through a repository — see [docs/providers.md](docs/providers.md).

## License

[MIT](LICENSE) © Joseph Spillers
