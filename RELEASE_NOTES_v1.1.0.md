# materialticket v1.1.0 — auth, identity, and the network map

This release makes materialticket a complete multi-user product: real
authentication (local + SSO + SAML), MFA on by default, role-based access
control, a PostgreSQL foundation, and a live network map of your devices.

## ⚠️ Upgrade notes (breaking)

- **Database is now PostgreSQL** (was MariaDB). `DATABASE_URL` changes from
  `mysql://…:3306/…` to `postgresql://…:5432/…`. There are no migration files to
  port — run `npx prisma db push` against a fresh Postgres database. Docker Compose
  and the k8s manifests now ship Postgres 16.
- **Auth is enforced.** Set `AUTH_SESSION_SECRET` (`openssl rand -hex 32`) and a
  `BOOTSTRAP_ADMIN_PASSWORD` to create the first admin, or keep `OIDC_DISABLED=true`
  for password-less local dev. The old "OIDC bearer only" model still works for API
  clients but the browser now uses session cookies.

## Highlights

- **🔐 Three auth methods, side by side** — local username/password accounts, **OIDC
  SSO** (Azure AD, Authentik, Okta, …) via a full authorization-code login, and
  **SAML 2.0**. Enable any combination from **Admin → Authentication**, or seed it
  from environment variables.
- **🛡️ MFA on by default** — local accounts enroll a TOTP authenticator (scan a QR
  code) and receive one-time recovery codes. Toggle with `MFA_REQUIRED`.
- **👮 RBAC enforced everywhere** — `admin` / `technician` / `readonly` roles. Read-only
  users can't mutate; admin-only surfaces (users, auth settings, probes, sync) require
  admin. Manage users and roles from the new **Admin → Users** panel.
- **🗺️ Network view** — the NetViz radial map, ported into the app: probe-discovered
  devices orbit a central node, colored by status and sized by open ports, with a
  detail panel. Driven by the local Device table — no live NetViz instance required.
- **🐘 PostgreSQL** — `jsonb` for device/audit/config data, plus **full-text ticket
  search** (`GET /tickets/search?q=`) backed by a `tsvector` GIN index, and partial
  indexes on hot query paths.
- **🔒 Security hardening** — server-side sessions (only a token *hash* is stored;
  instant revocation on logout / password change / deactivation), bcrypt password
  hashing, write-only secret handling in the Admin API, and rate-limited login/MFA
  endpoints.

## Other changes

- NetViz ↔ MaterialTicket device-ingest integration finalized and verified against
  the NetViz `internal/materialticket` serializer (contract v1).
- Backend unit tests (ts-jest) for the security-critical auth primitives.
- Docs, schema reference, and the landing site updated for Postgres + auth + Network.

## Getting started

```bash
docker compose up -d db adminer
cp backend/.env.example backend/.env   # set DATABASE_URL; AUTH_SESSION_SECRET + BOOTSTRAP_ADMIN_PASSWORD for a real login
cd backend && npx prisma db push && npm install && npm start
cd ../web-client && npm install && npm run dev   # http://localhost:5173
```

Prebuilt images: `ghcr.io/spilloid/materialticket-backend:1.1.0`,
`ghcr.io/spilloid/materialticket-web-client:1.1.0`.

## Notes

- Stack: React + MUI · Fastify + TypeScript · Prisma · **PostgreSQL**
- License: MIT
