# anchordesk — CLAUDE.md

Developer reference for working with this codebase. Keep this document updated as the project evolves.

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
>
> **As of 2.0.0 ("Signal & Spectrum"):** the application-design pass is complete across identity, data integrity, and device context.
> - **Per-user appearance** — seven MUI palettes are selected from Account → Appearance, stored in `User.themePref`, and mirrored locally for immediate startup color.
> - **Ticket/company guarantee** — repository creation resolves every ticket to a real Company; inbound IMAP can match/create by sender domain and otherwise uses `INTERNAL_COMPANY_NAME` (`SpillersTech`). Contact editing, atomic primary selection, and fresh-compose recipient defaults complete the customer flow.
> - **Workflow legibility** — status dots and priority icons are shared across cards, tables, and selectors; activity uses a timeline rail; narrow Kanban boards scroll fixed-width columns.
> - **Network intelligence** — bundled lazy OUI lookup plus port/vendor classification enriches device writes non-destructively. The MIT-licensed netviz Canvas map provides categorized clusters, labels, zoom/pan, hover/select, and linked-ticket context.
>
> **As of 2.1.0 ("Pocket & Anchor"):** the web client is **mobile-first**, and the helpdesk gains the queue, configuration, and automation primitives identified by the Zammad/Autotask/JSM audit.
> - **Responsive foundation** — `buildTheme()` adds phone-width dialog chrome + `responsiveFontSizes`; `theme/useIsPhone.ts` (`breakpoints.down("sm")`) drives `fullScreen` on TicketDialog, the email composer, CreateTicketDialog, and RunScriptDialog; App shell padding/toolbar compact at `xs`; `main` carries `minWidth: 0` so Kanban scrolls inside it instead of stretching the page.
> - **Touch affordances** — the Kanban close button is visible under `@media (hover: none)`; the network map gained two-finger pinch-zoom (with `pointercancel` handling) and on-screen `+/−/reset` buttons.
> - **Verification harness** — `docs/scripts/mock-api.mjs` (shared mock API) + `docs/scripts/capture-mobile-media.mjs` screenshot the core views and 2.1 workflow/admin dialogs across 5 touch device profiles (344–717px) against the Vite dev server with no backend; output is gitignored under `docs/assets/screenshots/mobile/`. A vitest guard asserts the core dialogs render full-screen at phone width.
> - **Configurable operations** — `Team`/`TeamMember` add queue routing; `CustomFieldDef` validates JSON-backed ticket fields; `SavedView` stores personal/admin-shared filters; `User.kanbanColumns` stores the ordered board vocabulary. Admin CRUD lives under `/teams`, `/custom-fields`, `/automations`, and `/views` (views are owner-scoped; shared publishing is admin-only).
> - **Automation + escalation** — `automationService` observes ticket/note/SLA events. All-of conditions cover normal fields, labels, `custom.<key>`, and SLA context; actions update/assign/tag/note/notify through existing repositories. `automation:<rule>` attribution both audits actions and prevents rule loops.
> - **Configuration records** — devices add asset/lifecycle fields and `DeviceExternalRef`, so multiple RMM/probe identities resolve to one physical record. Sync matches provider ref → MAC → company-scoped serial → hostname+company, preserves locally maintained asset data, and lets live/script routes select the provider; legacy external columns remain the primary back-compat reference.
> - **MCP parity** — ticket tools accept team/custom-field data and the server exposes labels, teams, custom-field definitions, saved views, ranked search, and ticket history under the connection user's normal RBAC/audit identity.
> - **The rule** — every view must stay usable on a 360px touch screen; UI changes are screenshot-verified at phone widths before merge, and new views must be added to the capture script. See `docs/mobile.md`.
>
> **As of 2.2.0 ("Clock & Compass"):** tickets gain explicit manual deadlines, daily views surface more of the existing queue/configuration context, and both application stacks move to their current release lines.
> - **Manual deadlines** — nullable/indexed `Ticket.dueAt` is accepted by REST create/update and MCP `create_ticket` / `update_ticket`. While set it overrides only the SLA resolution target (including scheduler/automation evaluation); clearing it falls back to `resolutionDueAt`, and the response clock is unchanged. `SlaChip`, TicketDialog, cards, and the virtualized table all carry the effective date.
> - **Read-side configuration** — ticket cards/table show teams, active custom-field definitions become dynamic table columns and advanced-search controls, and `GET /tickets?cf.<key>=<value>` builds validated typed `jsonb` equality predicates. Saved views preserve team and custom-field filters.
> - **Attribution + device context** — `automation:<rule>` actors render as named Automation badges in ticket history and notes; Network exposes all provider references on the selected device; Canvas nodes add device-type emoji while retaining labels, colors, and status cues.
> - **Board craft** — Kanban status columns are directly draggable and save through the existing `User.kanbanColumns` preference; ticket drag-between-status remains a separate drag type.
> - **Platform refresh** — the backend uses Fastify 5 with compatible `@fastify/*` plugins (no `fastify-autoload`), otplib 13, dotenv 17, TypeScript 7, `tsx`, and Jest 30 + SWC. The web uses React 19, React Router 7, Vite 8, Vitest 4, MUI 9, and Data Grid 9.
> - **Mobile harness** — mock data includes deadlines, automation activity, external references, and typed field filters; the five-device matrix adds Advanced search and Ticket history, and the phone-width test guards Advanced search plus the full TicketDialog.

> **As of 2.3.0 ("Compass Calibration"):** a calibration pass on the 2.2 line. MCP `list_tickets` accepts typed `customFields` filters through the same coercion path REST uses (`coerceCustomFieldFilters`); archived custom-field definitions filter again (archiving preserves data); repeated `cf.<key>` params 400; local-only edits (`dueAt`/team/custom fields) no longer mark external tickets sync-pending; automation conditions split `dueAt` (manual only) from `effectiveDueAt` (manual ?? SLA target); ticket export shows the effective due date; web client on TypeScript 6.0.3 + typescript-eslint 8 (TS7 blocked for web until typescript-eslint supports it); the project site split into a landing page + documentation hub.
>
> **As of 2.4.0 ("Checklist & Console"):** checklists with templates, an admin console rework, and a self-service setup path.
> - **Checklists** — `ChecklistTemplate`/`ChecklistTemplateItem`/`ChecklistItem`: admin-managed boilerplate lists are **copied** onto tickets at apply time (provenance `templateId` is deliberately not a FK — template edits/deletes never touch ticket work). Template items carry relative `dueOffsetMinutes`; instantiated items get independent per-item `dueAt` deadlines (never fed into SLA/manual ticket clocks), done attribution (`doneBy`/`doneAt`), and live updates via `ticket.updated` + checklist tag. REST: `/checklist-templates` CRUD (admin) + `/tickets/:id/checklist` CRUD + `apply-template`. MCP: `list_checklist_templates`, `apply_checklist_template`, `add_checklist_item`, `toggle_checklist_item`; `get_ticket` includes the checklist. UI: TicketDialog section (progress bar, overdue chips, phone-safe date editor) + Admin → Checklists (first panel in `components/admin/`).
> - **Admin console** — active section lives in the `?admin=` query param (deep-linkable, back-button-safe); rail grouped under People & Access / Ticketing / Channels & Integrations / Infrastructure; AdminView lazy-loads out of the main bundle; shared `ConfirmDialog` replaced all `window.confirm`; `PanelSearch` quick filters on Users/Devices/Audit; guided empty states.
> - **Visual automation builder** — condition/action rows with pickers driven by the backend vocabulary (team/user/label selects, priority menus, datetime hints); `POST /automations/preview` dry-runs conditions against the last 7 days of tickets ("would have matched N"); raw JSON demoted to an Advanced toggle.
> - **Vocabulary enforcement** — `backend/src/services/ticketVocab.ts` is the server's status/priority source of truth (mirrors web `ticketVocab.ts`); REST + MCP writes canonicalize case-insensitively and reject unknowns (the MCP tools previously suggested a fictional "Open" status and defaulted priority to numeric '3'). External provider sync is exempt by design.
> - **First-run + upgrades** — `GET /auth/setup-status` / `POST /auth/setup` (public, but gated by an empty users table) drive a login-screen wizard that creates the initial admin; `db/dataMigrations.ts` runs idempotent data fixes on every boot (stray status/priority normalization); `docs/upgrading.md` documents the pull-restart-done upgrade path.
>
> **As of 2.4.1:** checklist MCP parity is complete. In addition to the 2.4.0 apply/add/toggle tools and checklist data in `get_ticket`, agents can explicitly list, fully update, and delete working items; admins can create/update/delete templates through role-gated MCP tools. The server initialize version follows `backend/package.json`, and an SDK client/in-memory transport test guards the advertised tool contract. ChatGPT freezes approved MCP actions: refresh them under Workspace Settings → Apps → Action control on Enterprise/Edu, or recreate and republish the app on Business.

Key design goals:
- Excellent standalone ticketing experience first
- Sync to/from external platforms second
- **MCP parity is a release invariant:** every ticket workflow exposed through web/REST must ship with equivalent MCP tools and protocol-level discovery/call coverage in the same change and release
- **Mobile-first web client — every view must remain usable on a 360px-wide touch screen (hard requirement; see [docs/mobile.md](docs/mobile.md))**
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
     ├── ConnectWiseProvider  (two-way: CW Manage tickets + notes)
     ├── JiraProvider         (two-way: Jira Cloud issues + comments)
     ├── NetVizProvider       (probe → device ingest)
     ├── TacticalRmmProvider  (device sync + script runner)
     ├── NinjaOneProvider     (device sync + script runner — OAuth2 client-credentials)
     ├── DattoRmmProvider     (device sync + quick-job runner — OAuth2 password grant)
     └── imapService          (inbound mail → tickets since 1.6; scheduler-driven, not a TicketProvider)
```

GoF patterns in use:
- **Strategy** — `TicketProvider`, `DeviceProvider`, and `ScriptRunner` interfaces (see `src/providers/`, `src/runners/`)
- **Repository** — `src/repositories/` wraps all Prisma queries; routes never touch Prisma directly
- **Observer (append-only log)** — every mutation goes through `auditRepository.record()` before responding
- **Registry** — `src/rmm/registry.ts` maps a device-source key (`tactical_rmm` / `ninjaone` / `datto_rmm`) to an `RmmAdapter` bundling its config-check + `DeviceProvider` + script catalogue + live snapshot

### Multi-RMM (Tactical / NinjaOne / Datto)
Devices + scripts flow through two Strategy families keyed by provider:
`DeviceProvider` (sync) and `ScriptRunner` (scripts), with `rmm/registry.ts` as the
single lookup the routes use instead of hard-coding a platform. `/rmm/status`
reports every RMM's `configured`/`hasScriptCatalog`; `/scripts?provider=` and
`POST /devices/sync?provider=` select the RMM (both default to Tactical for
back-compat); `/devices/:id/live?provider=` and script-run bodies can select one
of a device's external references. `DeviceExternalRef` retains each provider's
external id while the legacy device columns mirror the primary source. External
sync resolves by provider reference, then MAC, company-scoped serial, or
hostname+company, so
one physical configuration record can merge telemetry from several RMMs without
losing local asset fields. NinjaOne and Datto both
authenticate with cached OAuth2 tokens (`ninjaService` client-credentials,
`dattoService` password grant against the fixed `public-client`). Datto script runs
are asynchronous **quick jobs** (queue a component UID, poll the job) and Datto
exposes no component catalogue over the API, so the run dialog collects the UID by
hand. Config for all three is seeded from env and editable in **Admin →
Integrations** (`ninjaone` / `datto` settings rows; DB wins). Adding another RMM =
a service client + a `DeviceProvider` + a `ScriptRunner` + one `RmmAdapter` in the
registry + the two enum values.

### Two-way ticket sync (ConnectWise / Jira) — ALPHA
External tickets sync in both directions, staying visible as external and badged by
their sync state. `TicketProvider` gained `canWriteBack` + `getTicket` /
`updateTicket` / `pushNote`; `ConnectWiseProvider` and `JiraProvider` (Jira Cloud
v3, ADF bodies, email+token auth) implement them. `services/twoWaySync.ts` owns the
reconcile: each ticket carries `syncState` (`synced` / `pending` / `conflict` /
`error`), a `remoteHash` fingerprint, and `syncedAt`. A local edit marks the ticket
`pending` (in the route layer, so inbound apply doesn't self-trigger) and kicks a
reconcile that pushes status/priority/assignee + unsynced notes. **Conflict policy
is flag-and-hold**: if the remote also changed since `syncedAt`, the ticket goes
`conflict` and auto-sync pauses until a human resolves it (`POST
/tickets/:id/resolve-conflict` with `local` or `remote`); `POST /tickets/:id/sync`
reconciles on demand. Batch sync (`syncService`) routes two-way providers through
reconcile instead of the blind inbound overwrite used for read-only sources. Config
seeds from env, editable in **Admin → Integrations** (`jira` row). Since we lack
live credentials, provider request shapes are written to the published APIs but not
yet exercised end to end.

### Auth flow (1.1.0)
- `middleware/auth.ts` runs on every request. It resolves a **session cookie** (browser login), a **personal access token** (`Authorization: Bearer adk_…`, resolved locally — see below), or an **OIDC bearer token** (API clients) to a `request.user` carrying a role, then enforces baseline RBAC (`readonly` can't mutate). `requireRole('admin')` gates admin surfaces. Public paths: `/ping`, `/probe/*`, and the `/auth/*` login endpoints.

### Personal access tokens / MCP auth
- **Personal access tokens (PATs)** let credential-limited programmatic clients — the **MCP voice agent** being the motivating case — authenticate *as a real user*. Users mint/revoke their own from the account menu (**API tokens**); the raw `adk_…` token is shown once and only its SHA-256 hash is stored (`ApiToken`, mirrors `Session`). A PAT carries the owner's role, so RBAC is unchanged. Minting is gated to interactive logins (a token can't farm more tokens); admins may revoke anyone's. Service: `services/auth/apiTokens.ts`; routes: `routes/apiTokens.ts`.
- **Audit attribution** stays the real user, tagged with the channel they came through: `actorFor(username, channel)` yields `alice` (web), `alice (api)` (token REST), or `alice (mcp)` (MCP). The actor flows via `request.actorSub`, so every existing repository audit records the right person + channel with no route changes. The MCP server is built per SSE connection bound to that connection's user (`buildMcpServer(actor)`) — MCP mutations are no longer a flat `'mcp'`.
- **Connecting MCP:** header-capable clients can point SSE at `/mcp/sse` with `Authorization: Bearer <token>` (see `.mcp.json`, which reads `${ANCHORDESK_TOKEN}`). OAuth-capable clients such as ChatGPT's custom connector run the full authorization-code + PKCE flow against **AnchorDesk's own built-in OAuth server** (see below). The `/mcp/*` endpoints are *not* public — they require a valid PAT, OIDC bearer, or session. With `OIDC_DISABLED=true` (dev) every request is the dev admin, including MCP.
- **Built-in OAuth server (MCP):** AnchorDesk is its own OAuth 2.0 authorization server for MCP, rather than delegating to the OIDC issuer — clients like ChatGPT require **Dynamic Client Registration** (RFC 7591), which few external IdPs allow, and self-hosting keeps the resource + authorization servers on one origin (what these clients expect). `/.well-known/oauth-protected-resource` advertises `APP_BASE_URL` as the authorization server; `/.well-known/oauth-authorization-server` (RFC 8414) points at `/oauth/register` (DCR — public clients, PKCE, no secret), `/oauth/authorize` (session-gated consent screen; an unauthenticated user is bounced to the SPA login via `?oauth_return=` and returned after sign-in), and `/oauth/token`. **The issued access token is a freshly minted PAT** for the approving user, so the existing bearer path validates it offline with zero new code and it's revocable from **Account → API tokens**. Auth codes are single-use, PKCE-S256-bound, and short-lived. Logic: `services/auth/oauthProvider.ts`; routes: `routes/oauth.ts`; nginx + Vite proxy `/oauth` and `/.well-known/oauth-authorization-server` to the backend. Adding these endpoints as an MCP connector: point ChatGPT's custom connector at `${APP_BASE_URL}/mcp/sse` — discovery, registration, and consent are automatic.
- Login flows live in `routes/auth.ts` → services in `services/auth/` (`password`, `sessions`, `oidcService`, `samlService`, `totp`, `authConfig`, `bootstrap`).
- Auth config is seeded from env on first boot into the `auth_settings` row, then editable from **Admin → Authentication** (DB wins). Secrets are write-only over the API.

---

## Local dev setup

### Prerequisites
- Node.js 22.12 or newer (CI baseline), npm
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
| PUT | `/auth/theme` | Save the current user's validated palette id |
| PUT | `/auth/kanban-columns` | Save/reset the current user's ordered board statuses |
| GET/POST | `/auth/tokens` · DELETE `/auth/tokens/:id` | Self-service personal access tokens (list / mint / revoke) |
| * | `/users`, `/users/:id`, `/users/:id/password` | Admin user CRUD (admin role) |
| GET/PATCH | `/auth/settings` | Admin: view/edit auth config (admin role) |

### Local tickets (PostgreSQL — source of truth)

| Method | Path | Description |
|---|---|---|
| GET | `/tickets` | List tickets — **paged** `{ items, total, page, pageSize }` (filters include status, assignee, company, label, `teamId`, typed `cf.<key>` equality, q, closed visibility, page, pageSize) |
| GET | `/tickets/search?q=` | **Postgres full-text search** (ranked) |
| GET | `/tickets/:id` | Get one ticket with notes |
| POST | `/tickets` | Create ticket (`dueAt`: optional ISO 8601 manual deadline) |
| PATCH | `/tickets/:id` | Update ticket fields (`dueAt`: ISO 8601, or `null` to restore the SLA resolution target) |
| DELETE | `/tickets/:id` | Soft-delete (status → Deleted) |
| GET | `/tickets/:id/history` | Full audit log for this ticket |
| GET | `/tickets/:id/notes` | List notes |
| POST | `/tickets/:id/notes` | Add note |
| PATCH | `/tickets/:id/notes/:noteId` | Edit note |
| DELETE | `/tickets/:id/notes/:noteId` | Delete note |
| GET | `/tickets/:id/time` · POST | Total logged minutes / log time (duration **or** `start`+`stop`) |
| POST | `/tickets/:id/email` | Send HTML email from the ticket — sanitized, threaded, recorded as an `email` note |
| GET | `/mail/status` | SMTP config status for the composer (no credentials) |

### Teams, fields, automation, and views (2.1.0)

| Method | Path | Description |
|---|---|---|
| GET | `/teams` · `/teams/:id` | Authenticated team/membership lookup for queues and pickers |
| POST/PATCH/DELETE | `/teams/*` | Admin team CRUD and membership management |
| GET | `/custom-fields` | Active definitions; `includeArchived=true` is available to admins |
| POST/PATCH/DELETE | `/custom-fields/*` | Admin definition management; deletion archives to preserve ticket data |
| GET/POST/PATCH/DELETE | `/automations/*` | Admin event-rule management, including SLA escalation rules |
| GET/POST/PATCH/DELETE | `/views/*` | Own plus shared saved filters; only admins may publish/edit shared views |
| GET/POST/DELETE | `/devices/:id/external-refs/*` | Provider identities attached to one physical device |

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
| `backend/src/repositories/teamRepository.ts` · `customFieldRepository.ts` · `savedViewRepository.ts` | Team queues, custom-field definitions, and owner-scoped saved filters |
| `backend/src/services/automation/` · `automationRepository.ts` | Pure rule evaluation + event-driven, audited actions and SLA escalation |
| `backend/src/repositories/deviceRepository.ts` | Local asset record, provider-reference identity/merge, and ticket links |
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
| `backend/src/services/oui/` · `deviceClassify.ts` | Lazy OUI vendor lookup and non-destructive port/vendor device classification |
| `web-client/src/components/NetworkView.tsx` · `NetworkMap.tsx` | AnchorDesk filtering/linked tickets around the netviz Canvas map |
| `web-client/src/components/AdminView.tsx` | Admin: Users, Authentication, Teams, Custom Fields, Automations, Sync, Probes, Devices, Mail |
| `web-client/src/App.tsx` | Main React component, auth gating, state management |
| `docs/architecture.md` | Architecture diagram and pattern rationale |
| `docs/schema.md` | Database schema documentation |
| `docs/providers.md` | How to add ticket providers and device/RMM adapters |

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
# Backend (Node.js 22.12+, matching CI)
cd backend
npm ci
npx prisma validate
npx prisma generate
npm test
npm run build

# Frontend
cd ../web-client
npm ci
npm test
npm run lint
npm run build
```

Backend tests use **Jest 30 + @swc/jest** (`backend/jest.config.js`) — SWC
transpiles TS for tests while `npm run build` (TypeScript 7 native `tsc`) owns
type checking, matching CI order. The dev runner is **tsx** (`npm start` =
`tsx watch src/index.ts`). The security-critical
auth primitives are covered in `backend/src/services/auth/__tests__/` (password
hashing, TOTP, recovery codes) plus provider normalization, custom-field
validation, automation evaluation, and auth serializers/guards. New DB-touching
tests should target the repositories/routes. UI changes also run the mocked
desktop drive and mobile screenshot matrix described in `docs/mobile.md`.

---

## Database schema changes

Always use `prisma db push` in dev (fast iteration, no migration files). When ready for a stable migration:

```bash
cd backend
npx prisma migrate dev --name describe_your_change
```

Migration files live in `backend/prisma/migrations/`.
