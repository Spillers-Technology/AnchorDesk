# anchordesk — CLAUDE.md

Developer reference for working with this codebase. Keep this document updated as the project evolves.

> **Local tooling note:** the GitHub CLI is installed at `C:\Program Files\GitHub CLI\gh.exe` (not on the Git Bash PATH — invoke it by full path, e.g. `"/c/Program Files/GitHub CLI/gh.exe"`). It's authenticated as `spilloid`. Note the token currently lacks `write:packages`, so pushing images to ghcr.io needs a PAT with that scope (or `gh auth refresh -s write:packages`).

---

## What this is

anchordesk is a **local-first ticketing system** built on Material UI design principles. The local PostgreSQL database is the source of truth; external systems (ConnectWise, IMAP, RMM tools) are sync adapters — not the core.

> **As of 1.1.0:** the database is **PostgreSQL** (was MariaDB) — chosen for `jsonb`, full-text search, and partial indexes. Auth is first-class: **local accounts + OIDC + SAML** with **server-side sessions**, **TOTP MFA (on by default)**, and **RBAC** (admin/technician/readonly). A **Network** view renders probe-discovered devices as a radial map.
>
> **As of 1.6.0:** tickets are a two-way **email conversation** — HTML compose (sanitized) with RFC 5322 threading so replies stay on the ticket; inbound IMAP mail keeps its HTML. The ticket list is **server-paginated** (`GET /tickets` returns `{ items, total, page, pageSize }`, not a bare array) with server-side search/filter and a virtualized table. **Probes link to companies** via `Probe.companyId`, which flows onto discovered devices. Time entries support **duration or start/stop**. MCP gained `log_time` + `send_ticket_email`.
>
> **As of 1.7.0 ("Close the loop"):** three additions complete the daily helpdesk loop.
> - **Attachments** — a pluggable storage seam (`AttachmentStorage` Strategy: `LocalDiskStorage` + `S3Storage` for any S3-compatible store — AWS, MinIO, R2, B2) holds bytes; Postgres holds `Attachment` metadata. Configured via env **or** Admin → Integrations `storage` row (DB wins). Inbound IMAP attachments are persisted; the email composer can attach files. Upload is `@fastify/multipart`; download streams from the row's recorded backend.
> - **Live layer (WebSockets)** — an in-process `eventBus` (Observer, alongside the audit log) publishes `ticket.*` / `note.added` / `sla.atRisk`; `wsHub` fans them over `@fastify/websocket` at `/ws` (session-authed on the upgrade). The web client live-updates lists/Kanban/open ticket and shows a notification bell.
> - **Notifications + SLA** — `notificationService` turns events into per-user `Notification` rows (pushed live). `SlaPolicy` sets response/resolution targets matched by priority/company (precedence: company+priority > company > priority > default); tickets carry `responseDueAt` / `resolutionDueAt` / `firstRespondedAt`, and `slaScheduler` emits at-risk/breach events. Reactive SLA chips render on list/card/board/ticket.
>
> **As of 1.8.0 ("Comms & Craft"):** email becomes multi-identity and the ticket becomes a polished, exportable record.
> - **Email** — Cc/**Bcc**; **send-from identities** (`MailIdentity`: shared boxes like help@/support@ + per-user aliases) set the From header while the SMTP envelope/auth stay the relay (SPF/DKIM intact); per-user **signatures** (`User.signatureHtml`) + reusable **templates** (`MailTemplate`); composer has contact **autocomplete** for To/Cc/Bcc. Pasted/dropped composer images upload to the ticket and are sent as inline `cid:` parts so external clients render them.
>   - **Relay caveat:** because the header From is the chosen identity while the envelope sender stays the authenticated SMTP account, the relay must allow sending as that address (normal for same-domain aliases). If it enforces sender == auth-user it will reject the send; `routes/mail.ts` turns a 5xx relay rejection on a chosen identity into a clear 422 ("relay may not permit this From") rather than a bare 502.
> - **Labels** (`Label` + `TicketLabel`) — managed tags; **mailboxes auto-apply a label** (`Mailbox.labelId`) so catchall vs help@ vs personal inboxes land tagged differently; `GET /tickets?labelId=` filters.
> - **Inline images** — inbound `cid:` images are stored as attachments and rewritten to `/api/attachments/:id/download`; the sanitizer allows stored/relative image URLs + `loading`; the timeline renders HTML for internal notes too (script logs, images) with `max-width`/lazy so layout never breaks.
> - **Script logs** — a finished `ScriptJob` with a `ticketId` appends its output to the timeline as a note (streams in live).
> - **Ticket export** — `GET /tickets/:id/export` returns a self-contained printable HTML doc (activity + images inlined as data URIs) for Print → PDF.
> - **Fuzzy search** — `pg_trgm` trigram similarity combined with FTS, across ticket text + priority + ticket number + note bodies (`ticketRepository.search`, indexes in `pgExtras`).
> - **Modal polish** — ticket-field edits show a live saving → saved/failed indicator.
>
> **As of 1.9.0 ("Thread & Signal"):** public ticket identity and integration operations are consistent end to end.
> - **Ticket numbering** — generated 4–6 digit `ticketNumber` values are independent of row IDs and render across cards, table, Kanban, dialog, search, exports, and tagged outbound subjects.
> - **Mail threading hardening** — outbound mail adds `[#NNNNN]`; inbound IMAP falls back to that subject token when RFC threading headers disappear. Message-ID columns are `varchar(255)` and bounded external strings are clamped before writes.
> - **Sync operations** — provider create/delete/toggle/run is available in the Sync view, with reusable provenance badges on tickets.
> - **Live Tactical panel** — `/devices/:id/live` fetches current Tactical agent state when a linked ticket opens.
> - **Operational safety** — positive-integer route parsing rejects NaN IDs, integration settings seed from env, and SOPS supports deployment secrets.

Key design goals:
- Excellent standalone ticketing experience first
- Sync to/from external platforms second
- Strong SOLID + GoF patterns at integration boundaries
- Full audit log on every mutation (revision history)

---

## Architecture

```
web-client (React + MUI)
     │  /api/* proxied by Vite dev server → backend:8060
     ▼
backend (Fastify + TypeScript)
     │  Prisma ORM  ·  auth (local/OIDC/SAML + sessions + RBAC)
     ▼
PostgreSQL :5432  ← source of truth
     │
  sync providers
     ├── ConnectWiseProvider  (reads/writes CW Manage)
     ├── NetVizProvider       (probe → device ingest)
     ├── TacticalRmmProvider  (device sync + script runner)
     ├── NinjaOneProvider     (device sync + script runner — OAuth2 client-credentials)
     ├── DattoRmmProvider     (device sync + quick-job runner — OAuth2 password grant)
     └── ImapProvider         (planned)
```

GoF patterns in use:
- **Strategy** — `TicketProvider`, `DeviceProvider`, and `ScriptRunner` interfaces (see `src/providers/`, `src/runners/`)
- **Repository** — `src/repositories/` wraps all Prisma queries; routes never touch Prisma directly
- **Observer (append-only log)** — every mutation goes through `auditRepository.record()` before responding
- **Registry** — `src/rmm/registry.ts` maps a device-source key (`tactical_rmm` / `ninjaone` / `datto_rmm`) to an `RmmAdapter` bundling its config-check + `DeviceProvider` + script catalogue + live snapshot

### Multi-RMM (Tactical / NinjaOne / Datto)
Devices + scripts flow through two Strategy families keyed by device source:
`DeviceProvider` (sync) and `ScriptRunner` (scripts), with `rmm/registry.ts` as the
single lookup the routes use instead of hard-coding a platform. `/rmm/status`
reports every RMM's `configured`/`hasScriptCatalog`; `/scripts?provider=` and
`POST /devices/sync?provider=` select the RMM (both default to Tactical for
back-compat); `/devices/:id/live` reads `device.source`. NinjaOne and Datto both
authenticate with cached OAuth2 tokens (`ninjaService` client-credentials,
`dattoService` password grant against the fixed `public-client`). Datto script runs
are asynchronous **quick jobs** (queue a component UID, poll the job) and Datto
exposes no component catalogue over the API, so the run dialog collects the UID by
hand. Config for all three is seeded from env and editable in **Admin →
Integrations** (`ninjaone` / `datto` settings rows; DB wins). Adding another RMM =
a service client + a `DeviceProvider` + a `ScriptRunner` + one `RmmAdapter` in the
registry + the two enum values.

### Auth flow (1.1.0)
- `middleware/auth.ts` runs on every request. It resolves a **session cookie** (browser login), a **personal access token** (`Authorization: Bearer adk_…`, resolved locally — see below), or an **OIDC bearer token** (API clients) to a `request.user` carrying a role, then enforces baseline RBAC (`readonly` can't mutate). `requireRole('admin')` gates admin surfaces. Public paths: `/ping`, `/probe/*`, and the `/auth/*` login endpoints.

### Personal access tokens / MCP auth
- **Personal access tokens (PATs)** let credential-limited programmatic clients — the **MCP voice agent** being the motivating case — authenticate *as a real user*. Users mint/revoke their own from the account menu (**API tokens**); the raw `adk_…` token is shown once and only its SHA-256 hash is stored (`ApiToken`, mirrors `Session`). A PAT carries the owner's role, so RBAC is unchanged. Minting is gated to interactive logins (a token can't farm more tokens); admins may revoke anyone's. Service: `services/auth/apiTokens.ts`; routes: `routes/apiTokens.ts`.
- **Audit attribution** stays the real user, tagged with the channel they came through: `actorFor(username, channel)` yields `alice` (web), `alice (api)` (token REST), or `alice (mcp)` (MCP). The actor flows via `request.actorSub`, so every existing repository audit records the right person + channel with no route changes. The MCP server is built per SSE connection bound to that connection's user (`buildMcpServer(actor)`) — MCP mutations are no longer a flat `'mcp'`.
- **Connecting MCP:** point an SSE client at `/mcp/sse` with `Authorization: Bearer <token>` (see `.mcp.json`, which reads `${ANCHORDESK_TOKEN}`). The `/mcp/*` endpoints are *not* public — they require a valid PAT (or a session). With `OIDC_DISABLED=true` (dev) every request is the dev admin, including MCP.
- Login flows live in `routes/auth.ts` → services in `services/auth/` (`password`, `sessions`, `oidcService`, `samlService`, `totp`, `authConfig`, `bootstrap`).
- Auth config is seeded from env on first boot into the `auth_settings` row, then editable from **Admin → Authentication** (DB wins). Secrets are write-only over the API.

---

## Local dev setup

### Prerequisites
- Node.js ≥ 18, npm
- Docker + Docker Compose

### 1. Start the database

```bash
docker compose up -d db adminer
```

Adminer (DB browser) runs at http://localhost:8081 — server `db`, user `stadmin`, db `anchordesk`.

### 2. Configure the backend

```bash
cp backend/.env.example backend/.env
# Edit backend/.env — at minimum set DATABASE_URL and OIDC_DISABLED=true for local dev
```

### 3. Run Prisma migrations

```bash
cd backend
npx prisma db push        # push schema to DB (dev workflow — no migration files)
npx prisma studio         # optional: visual DB browser at localhost:5555
```

### 4. Start backend and frontend

```bash
# Terminal 1
cd backend && npm start

# Terminal 2
cd web-client && npm run dev
```

Frontend runs at http://localhost:5173 — all `/api/*` requests proxy to backend:8060.

### 5. Full Docker stack (production-like)

```bash
docker compose up --build
```

Services: frontend :5173, backend :8060, PostgreSQL :5432, Adminer :8081.

> **Logging in:** with `OIDC_DISABLED=true` every request runs as a dev admin (no login screen). For a real login, set `AUTH_SESSION_SECRET` + `BOOTSTRAP_ADMIN_PASSWORD` — the first boot creates a local admin; MFA enrollment is then required on first sign-in (set `MFA_REQUIRED=false` to skip).

---

## Environment variables

See [backend/.env.example](backend/.env.example) for the full list.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://user:pass@host:5432/anchordesk` |
| `APP_BASE_URL` | Prod | Public URL; builds OIDC/SAML callback URLs |
| `AUTH_SESSION_SECRET` | Prod | Signs session cookies (`openssl rand -hex 32`) |
| `BOOTSTRAP_ADMIN_PASSWORD` | First boot | Creates first local admin when users table is empty |
| `AUTH_LOCAL_ENABLED` | Optional | `false` = SSO-only |
| `MFA_REQUIRED` | Optional | TOTP MFA for local accounts — **on by default** |
| `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Optional | OIDC SSO (env seed; editable in Admin) |
| `SAML_ENTRY_POINT` / `SAML_ISSUER` / `SAML_IDP_CERT` | Optional | SAML 2.0 SSO |
| `OIDC_DISABLED` | Dev only | Set `true` to skip auth entirely (every request = dev admin) |
| `CWM_*` / `TRMM_*` / `SMTP_*` | Optional | ConnectWise / Tactical RMM / mail |

### OIDC provider examples

**Azure AD:**
```
OIDC_ISSUER_URL=https://login.microsoftonline.com/<tenant-id>/v2.0
```

**Authentik:**
```
OIDC_ISSUER_URL=https://authentik.yourdomain.com/application/o/<app-slug>/
```

---

## API endpoints

### Auth (1.1.0)

| Method | Path | Description |
|---|---|---|
| GET | `/auth/config` | Public — which login methods are enabled |
| POST | `/auth/login` | Local login → session cookie (or `mfaRequired`/`enrollmentRequired`) |
| POST | `/auth/mfa/verify` `/setup` `/enable` | TOTP verify / enroll (QR) / confirm |
| DELETE | `/auth/mfa` | Disable own MFA |
| GET | `/auth/oidc/login` · `/auth/oidc/callback` | OIDC SSO handshake |
| GET | `/auth/saml/login` · POST `/auth/saml/callback` · GET `/auth/saml/metadata` | SAML SSO |
| GET | `/auth/me` · POST `/auth/logout` · POST `/auth/password` | Current user / logout / change own password |
| GET/POST | `/auth/tokens` · DELETE `/auth/tokens/:id` | Self-service personal access tokens (list / mint / revoke) |
| * | `/users`, `/users/:id`, `/users/:id/password` | Admin user CRUD (admin role) |
| GET/PATCH | `/auth/settings` | Admin: view/edit auth config (admin role) |

### Local tickets (PostgreSQL — source of truth)

| Method | Path | Description |
|---|---|---|
| GET | `/tickets` | List tickets — **paged** `{ items, total, page, pageSize }` (filters: status, assignee, company, q, page, pageSize) |
| GET | `/tickets/search?q=` | **Postgres full-text search** (ranked) |
| GET | `/tickets/:id` | Get one ticket with notes |
| POST | `/tickets` | Create ticket |
| PATCH | `/tickets/:id` | Update ticket fields |
| DELETE | `/tickets/:id` | Soft-delete (status → Deleted) |
| GET | `/tickets/:id/history` | Full audit log for this ticket |
| GET | `/tickets/:id/notes` | List notes |
| POST | `/tickets/:id/notes` | Add note |
| PATCH | `/tickets/:id/notes/:noteId` | Edit note |
| DELETE | `/tickets/:id/notes/:noteId` | Delete note |
| GET | `/tickets/:id/time` · POST | Total logged minutes / log time (duration **or** `start`+`stop`) |
| POST | `/tickets/:id/email` | Send HTML email from the ticket — sanitized, threaded, recorded as an `email` note |
| GET | `/mail/status` | SMTP config status for the composer (no credentials) |

### ConnectWise passthrough (requires CWM_* env vars)

| Method | Path | Description |
|---|---|---|
| GET | `/cw/tickets/open` | Open tickets from CW board |
| GET | `/cw/tickets/:ticketId` | Single CW ticket |
| GET | `/cw/tickets/:ticketId/notes` | CW ticket notes |
| GET | `/cw/tickets/by-resource/:resource` | CW tickets filtered by technician |

### Utility
| GET | `/ping` | Health check — returns `pong` |

---

## Key files

| File | Purpose |
|---|---|
| `backend/prisma/schema.prisma` | Database schema (single source of truth for DB structure) |
| `backend/src/db/prisma.ts` | Singleton PrismaClient |
| `backend/src/repositories/ticketRepository.ts` | All ticket DB operations + audit recording |
| `backend/src/repositories/noteRepository.ts` | All note DB operations + audit recording |
| `backend/src/repositories/auditRepository.ts` | Audit log write + query |
| `backend/src/repositories/userRepository.ts` | User CRUD + SSO upsert + TOTP helpers (secrets never serialized) |
| `backend/src/middleware/auth.ts` | Unified session + bearer auth, RBAC (`requireRole`) |
| `backend/src/services/auth/` | `password`, `sessions`, `oidcService`, `samlService`, `totp`, `authConfig`, `bootstrap` |
| `backend/src/routes/auth.ts` | Login flows (local/OIDC/SAML), MFA, logout, self-service |
| `backend/src/routes/users.ts` | Admin user management + `/auth/settings` |
| `backend/src/db/pgExtras.ts` | Postgres full-text + partial indexes (ensured on boot) |
| `backend/src/providers/TicketProvider.ts` | **Strategy interface** for external sync sources |
| `backend/src/providers/NetVizProvider.ts` | netviz device-ingest normalizer (**owns the wire contract**) |
| `backend/src/services/mail/MailTransport.ts` | **Strategy interface** for outbound mail (SMTP impl alongside) |
| `backend/src/services/mail/ticketMail.ts` | Send + thread + record an email on a ticket (route delegates here) |
| `backend/src/services/mail/threading.ts` · `sanitizeHtml.ts` | Pure RFC 5322 threading helpers · shared inbound/outbound HTML sanitizer |
| `backend/src/routes/tickets.ts` | CRUD + full-text search for local tickets |
| `web-client/src/api/client.ts` | Frontend API client — all fetch calls go here |
| `web-client/src/auth/` | `AuthContext`, `LoginView`, `AccountMenu` |
| `web-client/src/components/NetworkView.tsx` | NetViz radial network map over Device data |
| `web-client/src/components/AdminView.tsx` | Admin: Users, Authentication, Sync, Probes, Devices, Mail |
| `web-client/src/App.tsx` | Main React component, auth gating, state management |
| `docs/architecture.md` | Architecture diagram and pattern rationale |
| `docs/schema.md` | Database schema documentation |
| `docs/providers.md` | How to add a new TicketProvider |

---

## Adding a new sync provider

See [docs/providers.md](docs/providers.md).

Short version:
1. Create `backend/src/providers/YourProvider.ts` implementing `TicketProvider`
2. Add your provider type to the `ProviderType` enum in `prisma/schema.prisma`
3. Insert a row into `sync_providers` with your config JSON
4. Wire it into the sync service (Phase 3)

---

## Running tests

```bash
# Backend
cd backend && npm test

# Frontend
cd web-client && npm test
```

Backend tests use **ts-jest** (`backend/jest.config.js`). The security-critical auth primitives are covered in `backend/src/services/auth/__tests__/` (password hashing, TOTP, recovery codes) plus the NetViz normalizer and the auth serializers/guards — all DB-free unit tests. New DB-touching tests should target the repositories/routes.

---

## Database schema changes

Always use `prisma db push` in dev (fast iteration, no migration files). When ready for a stable migration:

```bash
cd backend
npx prisma migrate dev --name describe_your_change
```

Migration files live in `backend/prisma/migrations/`.
