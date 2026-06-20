# Database Schema

materialticket uses PostgreSQL (since 1.1.0). The Prisma schema is the authoritative source of truth: [backend/prisma/schema.prisma](../backend/prisma/schema.prisma). `Json` columns are real `jsonb`, and ticket search uses a `tsvector` GIN index (see [backend/src/db/pgExtras.ts](../backend/src/db/pgExtras.ts)).

---

## Tables

### `tickets`

The core entity. Created locally or synced from an external source.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | Auto-increment local ID — use this for all API calls |
| `ticket_number` | VARCHAR | External ticket number (e.g. CW ticket #), or null for local-only |
| `title` | VARCHAR | Required. Short title / subject line |
| `summary` | VARCHAR | One-liner summary (may duplicate title for CW imports) |
| `description` | TEXT | Full description / initial note |
| `status` | VARCHAR | e.g. New, InProgress, Closed. Free-form string |
| `priority` | VARCHAR | e.g. Low, Medium, High, Critical |
| `company_name` | VARCHAR | Client company name (denormalized string, not FK) |
| `assignee` | VARCHAR | Display name of assigned technician |
| `assignee_id` | FK → users | Local user FK if assignee is a local user |
| `source` | ENUM | `local`, `connectwise`, `imap`, `api` |
| `external_id` | VARCHAR | ID in the upstream system |
| `external_provider` | VARCHAR | e.g. `connectwise`, `imap` |
| `closed_at` | DATETIME | Set when status transitions to a closed state |
| `created_at` | DATETIME | Immutable creation timestamp |
| `updated_at` | DATETIME | Auto-updated on every change |

**Unique constraint:** `(external_id, external_provider)` — prevents duplicate imports from the same source.

---

### `notes`

Normalized per-ticket notes and time entries.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | |
| `ticket_id` | FK → tickets | Cascades on delete |
| `content` | TEXT | Note body |
| `author` | VARCHAR | Display name (denormalized — preserved even if user is removed) |
| `author_id` | FK → users | Nullable — foreign notes won't have a local user |
| `note_type` | ENUM | `note` or `time_entry` |
| `time_start` | DATETIME | Start time for time entries |
| `time_stop` | DATETIME | Stop time for time entries |
| `external_id` | VARCHAR | ID in upstream system (for sync dedup) |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |

---

### `audit_log`

Append-only event stream. Every mutation (create/update/delete/sync) writes a record here. Never updated or deleted — provides full revision history.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT PK | |
| `entity_type` | VARCHAR | `ticket`, `note`, etc. |
| `entity_id` | INT | ID of the affected entity |
| `action` | ENUM | `create`, `update`, `delete`, `sync` |
| `changed_by` | VARCHAR | OIDC `sub` of the actor, or `system` for automated actions |
| `old_value` | JSON | Full snapshot of the record before the change |
| `new_value` | JSON | Full snapshot of the record after the change |
| `occurred_at` | DATETIME | Immutable timestamp |

Indexed on `(entity_type, entity_id)` for fast per-ticket history lookups.

---

### `users`

Accounts for all auth methods. Local accounts store an Argon2/bcrypt hash and an
optional TOTP secret; SSO accounts (OIDC/SAML) are keyed on `(auth_provider, subject)`.
Secrets (`password_hash`, `totp_secret`, `totp_recovery`) are never serialized to clients.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | |
| `auth_provider` | ENUM | `local`, `oidc`, `saml` |
| `subject` | VARCHAR | OIDC `sub` / SAML nameID (null for local). `(auth_provider, subject)` unique |
| `username` | VARCHAR UNIQUE | login name (local) or IdP `preferred_username` |
| `password_hash` | VARCHAR | bcrypt hash; null for SSO-only accounts |
| `display_name`, `email` | VARCHAR | profile fields |
| `role` | ENUM | `admin`, `technician`, `readonly` — enforced by RBAC |
| `is_active` | BOOL | deactivating kills live sessions |
| `totp_secret` / `totp_enabled` / `totp_recovery` | VARCHAR / BOOL / JSON | TOTP MFA state (recovery codes stored as hashes) |
| `last_seen_at`, `created_at`, `updated_at` | DATETIME | |

### `sessions`

Server-side sessions. The cookie holds an opaque random token; only its SHA-256
hash is stored, and deleting a row revokes the session instantly.

| Column | Type | Notes |
|---|---|---|
| `id` | CUID PK | |
| `user_id` | INT FK → users | cascade delete |
| `token_hash` | VARCHAR UNIQUE | SHA-256 of the cookie token |
| `user_agent`, `ip` | VARCHAR | request metadata |
| `expires_at`, `created_at` | DATETIME | pruned hourly |

### `auth_settings`

Single row (`id = 1`) holding the effective auth config (local/OIDC/SAML toggles +
public fields), seeded from env on first boot and editable from the Admin UI.
Secrets are write-only over the API.

---

### `sync_providers`

Configured external integrations. One row per configured source.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | |
| `name` | VARCHAR UNIQUE | Human label e.g. `ConnectWise Production` |
| `type` | ENUM | `connectwise`, `imap`, `tactical_rmm`, `meshcentral` |
| `config` | JSON | Provider-specific settings (credentials, URLs, etc.) |
| `enabled` | BOOL | Disable without deleting |
| `last_synced_at` | DATETIME | Timestamp of last successful sync run |
| `created_at` | DATETIME | |

---

### `sync_log`

Record of each individual sync operation (one row per external ticket synced).

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT PK | |
| `provider_id` | FK → sync_providers | |
| `external_id` | VARCHAR | External ticket ID |
| `internal_id` | FK → tickets | Local ticket ID if matched/created |
| `direction` | ENUM | `inbound` or `outbound` |
| `status` | ENUM | `success`, `error`, `skipped` |
| `message` | TEXT | Error message or skip reason |
| `synced_at` | DATETIME | |
