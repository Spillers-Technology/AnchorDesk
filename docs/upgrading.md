# Upgrading AnchorDesk

AnchorDesk upgrades in place. Both deployment styles apply the schema before
the app starts, and the backend runs idempotent **data migrations on every
boot** — so for most versions, upgrading is: pull the new images, restart,
done. Your tickets, notes, attachments, and settings stay where they are
(PostgreSQL is the source of truth; the app containers are stateless).

## The standard procedure

When upgrading an existing installation from 2.8.2 or earlier, take a backup
before the first migration-managed start:

```bash
pg_dump anchordesk > backup.sql
```

This backup is not optional for this upgrade. It is the release where the
schema-application mechanism changes from `db push` to versioned migrations.

**Docker Compose**

```bash
docker compose pull            # or: git pull && docker compose build
docker compose up -d           # backend runs `apply-schema.mjs` before starting
```

**Kubernetes**

Bump the image tags (e.g. `2.9.0`) and apply. The backend Deployment's
`prisma-migrate` init container runs `apply-schema.mjs` before the new pods
serve.

## How it works

- **Fresh installs** - `apply-schema.mjs` runs `prisma migrate deploy`.
  Migrations are applied in order and recorded in `_prisma_migrations`.
- **Existing installs upgrading from 2.8.2 or earlier** - no manual schema
  step is required. When `_prisma_migrations` is absent and `tickets` is
  present, `apply-schema.mjs` recognizes a database previously built by
  `db push`, records the existing schema as baseline `0_init`, and then deploys
  any later migrations. It does not rebuild or discard application tables.
  `apply-schema.mjs` invokes the installed Prisma CLI directly. The exact
  commands, which an operator can also run by hand from `backend/`, are:

  ```bash
  node node_modules/prisma/build/index.js migrate resolve --applied 0_init
  node node_modules/prisma/build/index.js migrate deploy
  ```

  The first command is run only once for a pre-2.9 database. If a database has
  tables but neither `_prisma_migrations` nor the `tickets` sentinel,
  `apply-schema.mjs` refuses to guess and instructs the operator to inspect it.
- **Data** — `backend/src/db/dataMigrations.ts` runs at every boot and
  applies idempotent data fixes (each is a no-op once applied). This is how
  historical inconsistencies get healed without manual SQL.

Starting the previous image tag remains a safe rollback for this transition.
The `_prisma_migrations` table is inert to AnchorDesk 2.8.2 and earlier; that
code simply runs `db push` over the same relational schema.

### Diffing a running installation

A running AnchorDesk database contains PostgreSQL-only objects created and
checked on every boot by `backend/src/db/pgExtras.ts` — extensions
(`pg_trgm`), GIN/partial/functional indexes (`idx_tickets_fts`,
`idx_tickets_trgm`, `idx_kb_articles_*`, `idx_ticket_events_backfill_occurred`,
`idx_tickets_active`, `idx_devices_company_status`,
`idx_notes_time_worked_ticket`), the `sessions_scope_principal_check`
constraint, `ticket_merges_one_live_per_source`, and the
`trg_tickets_single_level_hierarchy` / `trg_ticket_events_append_only` /
`trg_ticket_sla_snapshots_append_only` triggers. None of these are declared in
`schema.prisma`, by design (see the layering table above).

**Verified directly** (booted `ensurePgExtras` against a fresh migration-built
database, then ran `prisma migrate diff --from-url <that db> --to-migrations
./prisma/migrations --script`): Prisma's diff engine does not model
extensions, partial/functional/GIN indexes, CHECK constraints, or triggers at
all, so none of the objects above show up in a migration diff against a live
install — not because they're recognized as expected drift, but because
Prisma's diff mechanism is blind to that class of object entirely. The
*only* objects a live-install diff actually reports are two plain B-tree
performance indexes `pgExtras.ts` adds beyond what `schema.prisma` declares:
`idx_ticket_events_assignee_occurred` and `idx_ticket_events_team_occurred`
(both on `ticket_events`, alongside four schema-declared siblings
`pgExtras.ts` also idempotently re-creates). A diff reporting a `DROP INDEX`
for exactly those two is expected and correct, not migration drift; a diff
reporting anything else against a live install is worth investigating.

Use the migration-versus-datamodel check (`--to-schema-datamodel`, not
`--to-migrations`) against a disposable shadow database when checking whether
committed migrations match `schema.prisma` — that is the CI gate's own check
and is unaffected by any of the above.

## Version notes

### → 2.9.0

- AnchorDesk now applies ordered, recorded Prisma migrations through
  `apply-schema.mjs` instead of computing schema changes with `db push`.
- Before the first 2.9.0 start, installations upgrading from 2.8.2 or earlier
  must take a `pg_dump` backup. The startup script then detects and records the
  `0_init` baseline automatically; no manual migration command is required.
- Rolling back to a 2.8.2 or earlier image remains safe because its code ignores
  `_prisma_migrations` and sees the same relational schema.

### → 2.4.1 (Checklist MCP Parity)
- No schema or data migration. Pull the `2.4.1` images and restart normally.
- Header/PAT MCP clients should reconnect after the backend restart so their
  next `tools/list` sees the expanded checklist surface.
- ChatGPT keeps a frozen snapshot of approved MCP actions. Enterprise/Edu
  admins should open **Workspace Settings → Apps → AnchorDesk → Action
  control**, choose **Refresh**, review and enable the new actions, and publish
  the update. Business workspaces currently need to recreate and republish the
  app. Open a new chat after the workspace update. See OpenAI's
  [developer-mode and MCP apps guide](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta).

### → 2.4.0 (Checklist & Console)
- New tables (`checklist_templates`, `checklist_template_items`,
  `checklist_items`) are created by the schema push automatically.
- Boot data migration normalizes local tickets that carried out-of-vocabulary
  statuses/priorities (the MCP tooling historically suggested a fictional
  `"open"` status and a numeric priority default): casing is canonicalized,
  `open` → `New`, numeric priorities map to `Critical/High/Medium/Low`.
  External-provider tickets are never touched.
- The first-run wizard only appears on empty instances; existing
  installations never see it.

### → 2.3.0 (Compass Calibration)
- **Manual review needed if you use automations:** the `dueAt` condition
  field now matches only manually set deadlines. Rules that meant "has any
  deadline" should switch to `effectiveDueAt` (Admin → Automations — the
  visual builder labels both).

### → 2.2.0 (Clock & Compass)
- Adds the nullable `tickets.due_at` column (schema push handles it). No
  data changes.

### Older versions (1.x → 2.x)
- Upgrade sequentially through 2.0.0 if you're on 1.x: 2.0.0 introduced the
  ticket/company guarantee, which backfills company links on first boot.
- 1.0.x (MariaDB) → 1.1.0+ (PostgreSQL) is a data move, not an in-place
  upgrade — export/import or start fresh; nothing since 1.1.0 has changed
  the database engine.

## If something goes wrong

Roll back by starting the previous image tag — schema additions from the
newer version are ignored by older code (columns/tables sit unused), so
downgrade is safe unless a version note above says otherwise. Restore the
`pg_dump` only if data itself was damaged.
