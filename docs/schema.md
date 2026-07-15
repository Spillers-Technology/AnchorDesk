# Database Schema

anchordesk uses PostgreSQL (since 1.1.0). The Prisma schema is the authoritative source of truth: [backend/prisma/schema.prisma](../backend/prisma/schema.prisma). `Json` columns are real `jsonb`, and ticket search uses a `tsvector` GIN index (see [backend/src/db/pgExtras.ts](../backend/src/db/pgExtras.ts)).

---

## Tables

### `tickets`

The core entity. Created locally or synced from an external source.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | Auto-increment local ID — use this for all API calls |
| `ticket_number` | VARCHAR(50) | Public ticket number. Generated locally from `ticket_number_seq`, or retained from an external provider |
| `title` | VARCHAR | Required. Short title / subject line |
| `summary` | VARCHAR | One-liner summary (may duplicate title for CW imports) |
| `description` | TEXT | Full description / initial note; may contain sanitized HTML from the ticket modal |
| `status` | VARCHAR | e.g. New, InProgress, Closed. Free-form string |
| `priority` | VARCHAR | e.g. Low, Medium, High, Critical |
| `company_name` | VARCHAR | Client company name retained as a denormalized display/sync value |
| `company_id` | FK → companies | Local company record resolved for every newly created ticket |
| `contact_id` | FK → contacts | Optional ticket contact |
| `assignee` | VARCHAR | Display name of assigned technician |
| `assignee_id` | FK → users | Local user FK if assignee is a local user |
| `team_id` | FK → teams | Responsible queue/group, independent of individual assignment |
| `custom_fields` | JSON | Values keyed by active `custom_field_defs.key`; validated on every write |
| `source` | ENUM | `local`, `connectwise`, `jira`, `imap`, `api` |
| `external_id` | VARCHAR(255) | ID in the upstream system; may hold an RFC 5322 Message-ID for IMAP tickets |
| `external_provider` | VARCHAR | e.g. `connectwise`, `imap` |
| `sla_policy_id` | FK → sla_policies | Resolved SLA policy |
| `response_due_at`, `resolution_due_at` | DATETIME | Response/resolution deadlines derived from the policy |
| `first_responded_at` | DATETIME | First qualifying technician response; freezes the response clock |
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
| `note_type` | ENUM | `note`, `time_entry`, `email`, or system/agent-generated `internal` |
| `time_start` | DATETIME | Start time for time entries |
| `time_stop` | DATETIME | Stop time for time entries |
| `external_id` | VARCHAR(255) | ID in upstream system or RFC 5322 Message-ID (for sync/thread dedup) |
| `direction` | VARCHAR | `inbound` or `outbound` for email notes |
| `html_content` | TEXT | Sanitized HTML body for email and rich internal notes |
| `email_from`, `email_to`, `email_cc`, `email_bcc` | VARCHAR/TEXT | Email correspondence metadata |
| `subject` | VARCHAR(255) | Email subject, including the public ticket tag on outbound messages |
| `in_reply_to` | VARCHAR(255) | RFC 5322 Message-ID this email replied to |
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
| `changed_by` | VARCHAR | Actor and channel (web/API/MCP), `automation:<rule>`, or `system` |
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
| `theme_pref` | VARCHAR | Nullable per-user palette id; null uses Default Light |
| `kanban_columns` | JSON | Nullable ordered list of board status columns; null shows the default vocabulary |
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
| `type` | ENUM | `connectwise`, `jira`, `imap`, `tactical_rmm`, `ninjaone`, `datto_rmm`, `meshcentral`, `netviz` |
| `config` | JSON | Provider-specific non-secret settings. Shared credentials are managed under Admin → Integrations |
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
| `external_id` | VARCHAR(255) | External ticket ID |
| `internal_id` | FK → tickets | Local ticket ID if matched/created |
| `direction` | ENUM | `inbound` or `outbound` |
| `status` | ENUM | `success`, `error`, `skipped` |
| `message` | TEXT | Error message or skip reason |
| `synced_at` | DATETIME | |

---

### `teams` and `team_members`

Teams are helpdesk queues/groups. A ticket can belong to a team while remaining
unassigned to a specific technician.

| Table / column | Type | Notes |
|---|---|---|
| `teams.id` | INT PK | |
| `teams.name` | VARCHAR UNIQUE | Queue name |
| `teams.description` | VARCHAR | Optional operator-facing description |
| `team_members.team_id` | FK → teams | Cascades when the team is removed |
| `team_members.user_id` | FK → users | Cascades when the user is removed |

`team_members` has a composite primary key on `(team_id, user_id)`.

### `custom_field_defs`

Definitions for administrator-configured ticket fields. Per-ticket values stay
in `tickets.custom_fields` as `jsonb`; there is no EAV value table.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | |
| `key` | VARCHAR UNIQUE | Stable lowercase identifier used as the JSON key |
| `label` | VARCHAR | Display label |
| `type` | ENUM | `text`, `number`, `boolean`, `date`, or `select` |
| `options` | JSON | Allowed values for `select` fields |
| `required` | BOOL | Rejects blank/null/whitespace values when the field is supplied or edited, and prevents clearing an existing value; automated, email, and provider intake may omit it |
| `sort_order` | INT | Ticket-dialog ordering |
| `archived` | BOOL | Hides the definition while preserving stored ticket data |

Unknown or archived keys are rejected on incoming writes. Updates are merged
with the current JSON value so callers can change one field without replacing
the rest.

### `automation_rules`

Event-driven when/if/then rules evaluated by the in-process event bus.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | |
| `name` | VARCHAR | Used in audit actor `automation:<name>` |
| `enabled` | BOOL | Disabled rules are skipped without deletion |
| `trigger` | ENUM | `ticket_created`, `ticket_updated`, `note_added`, `sla_at_risk`, or `sla_breached` |
| `conditions` | JSON | All-of `{ field, op, value }[]` condition list |
| `actions` | JSON | Ordered action objects |
| `run_count`, `last_run_at` | INT / DATETIME | Execution observability |

Conditions support `eq`, `neq`, `contains`, `in`, `gte`, `lte`, `set`, and
`unset`; custom values use `custom.<key>`. Actions can set status/priority,
assign users/teams, add labels/notes, and notify users/teams. The automation
actor prefix prevents generated events from recursively running rules.

### `saved_views`

Persisted ticket filter sets for personal workspaces and shared service-desk
views.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | |
| `user_id` | Nullable FK → users | Owner of a personal view; shared views and dev-admin-owned views use null |
| `name` | VARCHAR | View label |
| `filters` | JSON | Ticket filters such as status, assignee, company, query, label, team, and closed visibility |
| `shared` | BOOL | Shared views are visible to everyone and may be published by admins only |
| `sort_order` | INT | UI ordering |

### `devices`

The local configuration/asset record for a physical device. Operational
providers may refresh telemetry without replacing locally maintained lifecycle
data.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | Local device identity used by tickets and scripts |
| `hostname`, `display_name`, `ip_address`, `mac_address` | VARCHAR | Network identity/display fields |
| `vendor`, `manufacturer`, `model` | VARCHAR | Vendor enrichment plus configuration-record make/model |
| `asset_tag`, `serial_number`, `location` | VARCHAR | Locally editable asset identity/location |
| `purchase_date`, `warranty_expires_at` | DATE | Lifecycle dates |
| `notes` | TEXT | Free-form configuration notes |
| `os`, `device_type`, `open_ports`, `status` | VARCHAR / JSON | Operational inventory and classification |
| `company_id`, `probe_id` | FK | Customer and scanner relationships |
| `source` | ENUM | Primary/back-compat source |
| `external_provider`, `external_id` | VARCHAR | Legacy primary external reference, retained for compatibility |
| `metadata` | JSON | Provider-specific data that does not belong in canonical columns |
| `first_seen_at`, `last_seen_at` | DATETIME | Observation window |

### `device_external_refs`

Provider identities for one physical device. Sync looks up
`(provider, external_id)` first, then falls back to MAC, company-scoped serial
number, or hostname plus company before creating a new device.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK | |
| `device_id` | FK → devices | Cascades with the local device |
| `provider`, `external_id` | VARCHAR | Provider-specific identity; globally unique as a pair |
| `metadata` | JSON | Reference-specific provider context |
| `first_seen_at`, `last_seen_at` | DATETIME | Observation timestamps for this provider |
| `created_at`, `updated_at` | DATETIME | Row lifecycle |

Each device can have at most one reference for a given provider
(`UNIQUE(device_id, provider)`). The legacy columns on `devices` mirror the
primary reference so existing clients and installations keep working. Backend
startup backfills those legacy pairs into this table before accepting traffic.

Scheduled script jobs persist the selected provider-specific external id and a
supported timeout. That pins a queued action to the machine selected by the
agent even if a device reference is edited before the scheduled time. Workers
claim queued rows with a conditional `queued -> running` update, so overlapping
scheduler/API calls cannot execute one job twice. Asynchronous providers persist
their invocation id and remain `running` until a status poll reports a terminal
result; an acknowledgement is never recorded as script success.

---

## Applying 2.1.0

The 2.1.0 changes are additive. This repository's deployment convention is
`npx prisma db push`; Docker Compose runs it during backend startup and the
Kubernetes development deployment uses a dedicated init container. Validate
and apply the schema before starting a manually managed backend:

```bash
cd backend
npx prisma validate
npx prisma generate
npx prisma db push
```
