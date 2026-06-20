# anchordesk — CLAUDE.md

Developer reference for working with this codebase. Keep this document updated as the project evolves.

---

## What this is

anchordesk is a **local-first ticketing system** built on Material UI design principles. The local PostgreSQL database is the source of truth; external systems (ConnectWise, IMAP, RMM tools) are sync adapters — not the core.

> **As of 1.1.0:** the database is **PostgreSQL** (was MariaDB) — chosen for `jsonb`, full-text search, and partial indexes. Auth is first-class: **local accounts + OIDC + SAML** with **server-side sessions**, **TOTP MFA (on by default)**, and **RBAC** (admin/technician/readonly). A **Network** view renders probe-discovered devices as a radial map.

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
     └── ImapProvider         (planned)
```

GoF patterns in use:
- **Strategy** — `TicketProvider`, `DeviceProvider`, and `ScriptRunner` interfaces (see `src/providers/`, `src/runners/`)
- **Repository** — `src/repositories/` wraps all Prisma queries; routes never touch Prisma directly
- **Observer (append-only log)** — every mutation goes through `auditRepository.record()` before responding

### Auth flow (1.1.0)
- `middleware/auth.ts` runs on every request. It resolves a **session cookie** (browser login) or an **OIDC bearer token** (API clients) to a `request.user` carrying a role, then enforces baseline RBAC (`readonly` can't mutate). `requireRole('admin')` gates admin surfaces. Public paths: `/ping`, `/probe/*`, and the `/auth/*` login endpoints.
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
| * | `/users`, `/users/:id`, `/users/:id/password` | Admin user CRUD (admin role) |
| GET/PATCH | `/auth/settings` | Admin: view/edit auth config (admin role) |

### Local tickets (PostgreSQL — source of truth)

| Method | Path | Description |
|---|---|---|
| GET | `/tickets` | List tickets (filters: status, assignee, company, page, pageSize) |
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
