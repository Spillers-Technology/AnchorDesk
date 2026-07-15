# Architecture

## Overview

anchordesk is a local-first ticketing system. The PostgreSQL database is the source of truth. External platforms (ConnectWise, IMAP, etc.) are sync adapters that feed into the local store — they are not the core.

```
┌──────────────────────────────────────────────────────────────┐
│                        anchordesk                        │
│                                                              │
│  ┌─────────────────┐        ┌─────────────────────────────┐ │
│  │  React + MUI    │ /api/* │  Fastify (Node.js + TS)     │ │
│  │  web-client     │───────►│  backend :8060               │ │
│  └─────────────────┘        └───────────┬─────────────────┘ │
│                                         │ Prisma ORM         │
│                                         ▼                    │
│                              ┌─────────────────────┐        │
│                              │  PostgreSQL :5432    │        │
│                              │  (source of truth)   │        │
│                              └──────────┬──────────┘        │
│                                         │                    │
│              ┌──────────────────────────┼─────────────────┐ │
│              │      Integration adapters & pollers         │ │
│              │  ┌────────────────┐  ┌───┴───────────────┐ │ │
│              │  │ConnectWise/Jira│  │ IMAP / SMTP       │ │ │
│              │  │two-way sync    │  │ mail services     │ │ │
│              │  └────────────────┘  └───────────────────┘ │ │
│              └─────────────────────────────────────────────┘ │
│                                                              │
│                  ┌──────────────────────────────────────┐   │
│                  │     Device providers & RMM runners    │   │
│                  │  netviz │ Tactical │ NinjaOne │ Datto │   │
│                  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## Design patterns

### Strategy — `TicketProvider` and `ScriptRunner`

External integrations are defined by interfaces, not concrete implementations. The sync service calls `provider.fetchTickets()` without knowing whether it's talking to ConnectWise, an IMAP inbox, or anything else.

```
TicketProvider (interface)
├── ConnectWiseProvider    implements TicketProvider
├── JiraProvider           implements TicketProvider
└── YourProvider           implements TicketProvider (add yours)

DeviceProvider (interface)
├── NetVizProvider         implements DeviceProvider
├── TacticalRmmProvider    implements DeviceProvider
├── NinjaOneProvider       implements DeviceProvider
└── DattoRmmProvider       implements DeviceProvider

ScriptRunner (interface)
├── TacticalRmmRunner      implements ScriptRunner
├── NinjaOneRunner         implements ScriptRunner
└── DattoRmmRunner         implements ScriptRunner
```

Adding a new integration means creating a new class — existing code does not change.

### Repository — data access layer

Routes never call Prisma directly. All database operations go through repositories:

```
ticketRepository.ts      — create/list/update, team + custom-field persistence
noteRepository.ts        — create, listForTicket, update, remove
deviceRepository.ts      — configuration record + provider-reference merge
teamRepository.ts        — queue CRUD and membership
customFieldRepository.ts — field definitions
automationRepository.ts  — rule persistence and run counters
savedViewRepository.ts   — owner/shared filter sets
auditRepository.ts       — record (write), getHistory (read)
```

Repositories are also responsible for recording audit events. Every mutation that goes through a repository automatically appends an audit log entry.

### Observer — audit, live updates, and automation

The `audit_log` table is an append-only event log. Every state change (create/update/delete/sync) writes a before/after snapshot to this table. This provides:
- Full revision history on any ticket
- Attribution (who changed what and when)
- An audit trail for compliance purposes

The in-process event bus is a separate live observer channel. Repositories
publish ticket/note changes and the SLA scheduler publishes warning/breach
events; the WebSocket hub, notification service, and 2.1 automation engine each
subscribe. Automation actions return through the repositories, so they are
audited and broadcast exactly like human actions. An `automation:<rule>` actor
prefix is the loop guard: generated events update clients but do not run rules
again.

### Factory — provider instantiation

The sync service instantiates providers from the `sync_providers` table using a
factory function. The factory reads `type` from the row and returns the correct
`TicketProvider` implementation. Provider instances are managed through the Sync
view and `/sync/providers` routes.

### Configuration-record identity — devices across RMMs

`Device` is the durable local asset/configuration record. A
`DeviceExternalRef` child keeps the external id for each RMM or probe that can
observe the same physical machine. Ingest resolves an exact provider reference
first, then falls back to MAC, company-scoped serial number, or hostname plus
company. This
keeps one local device for ticket links and asset/lifecycle data while still
allowing live lookups and scripts to select Tactical RMM, NinjaOne, or Datto RMM.

Provider telemetry may fill canonical operational fields, but locally maintained
asset tag, make/model, location, purchase/warranty dates, and notes are not
blindly replaced. The legacy external-provider/id fields mirror the primary
reference for backward compatibility.

---

## Request lifecycle

```
HTTP request
    │
    ▼
Fastify onRequest hook
    │ auth.ts — resolves session cookie OR bearer token
    │ sets request.user (with role) + request.actorSub
    │ enforces baseline RBAC (readonly cannot mutate)
    ▼
Route handler (routes/tickets.ts)
    │ optional requireRole('admin') preHandler
    │ validates input, extracts params
    ▼
Repository (repositories/ticketRepository.ts)
    │ validates custom fields / resolves team + SLA data
    │ Prisma query
    │ auditRepository.record() — before/after snapshot
    │ eventBus.publish() — live UI + notifications + automation
    ▼
PostgreSQL
    │
    ▼
JSON response
```

---

## Authentication & authorization

As of 1.1.0, three auth methods run side by side; an admin enables any combination
from **Admin → Authentication** (env vars seed the initial config on first boot).

- **Local accounts** — bcrypt password hashes, server-side sessions (opaque cookie
  token; only its SHA-256 hash is stored, so sessions are revocable). **TOTP MFA is
  on by default**: local users enroll an authenticator (QR) before first access and
  get one-time recovery codes.
- **OIDC** — interactive authorization-code login (PKCE + state + nonce) via
  `openid-client`, plus bearer-token validation for API clients. Works with Azure AD
  (`https://login.microsoftonline.com/<tenant>/v2.0`), Authentik
  (`https://authentik.host/application/o/<slug>/`), Okta, or any OIDC IdP.
- **MCP OAuth** — `/mcp/*` remains protected, but OAuth-capable clients can
  discover `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server`, dynamically register at
  `/oauth/register`, ask a signed-in user for consent at `/oauth/authorize`, and
  exchange a PKCE-bound code at `/oauth/token`. The returned bearer is a freshly
  minted personal access token for that user, so RBAC and audit attribution are
  unchanged.
- **SAML 2.0** — `@node-saml/node-saml` SP: AuthnRequest redirect, signed-assertion
  validation at the ACS endpoint, and SP metadata at `/auth/saml/metadata`.

Browser login methods culminate in a local session; API tokens and MCP OAuth
bearers resolve to the owning user per request. **RBAC** is enforced on every
request: `readonly` can only read, `technician` can mutate tickets/devices, and
admin-only surfaces (users, auth settings, teams, custom-field definitions,
automation, probes, and sync) require the `admin` role. Shared saved views may
only be published by admins. Set `OIDC_DISABLED=true` to bypass auth entirely in
local dev.

---

## Frontend data flow

```
App.tsx
  fetchTickets()   ─► GET /api/tickets    ─► ticketRepo.list()
  handleStatusChange() ─► PATCH /api/tickets/:id  ─► ticketRepo.update()
  fetchTicketNotes() ─► GET /api/tickets/:id/notes ─► noteRepo.listForTicket()

api/client.ts — all fetch() calls go through here
  - injects Authorization: Bearer <token> header
  - consistent error handling
  - single place to add retry logic later
```

---

## Delivery status

| Phase | Feature | Status |
|---|---|---|
| 1.1.0 | Local accounts + OIDC + SAML login, sessions, RBAC | **Done** |
| 1.1.0 | TOTP MFA (on by default) + recovery codes | **Done** |
| 1.1.0 | PostgreSQL migration + full-text ticket search | **Done** |
| 1.1.0 | Network view (NetViz radial map over devices) | **Done** |
| 1.6.0 | IMAP email-to-ticket + SMTP ticket replies | **Done** |
| 1.7.0 | Attachments, WebSockets, notifications, SLA | **Done** |
| 1.8.0 | Multi-identity email, labels, export, fuzzy search | **Done** |
| 1.9.0 | Public ticket numbers, subject threading fallback, sync management, live Tactical panel | **Done** |
| 1.10.0 | Personal access tokens + per-connection MCP auth (actor-attributed) | **Done** |
| 1.11.0 | Navigation / IA pass (board default, scoped Sync menus) | **Done** |
| 1.12.0 | My Day time day-spread, company-scoped device linking | **Done** |
| 1.13.0 | Page-fill board (no Closed column, fall-off close), regex advanced search, denser ticket cockpit, idempotent IMAP ingest | **Done** |
| 1.14.0 | NinjaOne + Datto RMM (device sync + scripts) and two-way ticket sync for ConnectWise + Jira Cloud — both alpha | **Done** |
| 1.15.0 | OAuth protected-resource metadata for hosted MCP clients | **Done** |
| 1.16.0 | Built-in OAuth 2.0 authorization server for MCP with Dynamic Client Registration, consent, PKCE, and minted per-user API tokens | **Done** |
| 1.17.0 | Rich-text ticket modal, separate rich note composer, bulk ticket updates, unified contact picker, and server-side HTML sanitizing | **Done** |
| 2.0.0 | Per-user palettes, mandatory ticket-company resolution, contact/composer completion, workflow signifiers, and OUI-enriched Canvas network map | **Done** |
| 2.1.0 | Mobile-first UI, team queues, custom fields, automation/SLA escalation, saved views/Kanban preferences, expanded MCP tools, and multi-RMM configuration records | **Done** |
| Roadmap | Postgres LISTEN/NOTIFY for live probe status | Planned |
