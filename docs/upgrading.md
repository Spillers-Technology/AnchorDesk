# Upgrading AnchorDesk

AnchorDesk upgrades in place. Both deployment styles apply the schema before
the app starts, and the backend runs idempotent **data migrations on every
boot** — so for most versions, upgrading is: pull the new images, restart,
done. Your tickets, notes, attachments, and settings stay where they are
(PostgreSQL is the source of truth; the app containers are stateless).

## The standard procedure

**Docker Compose**

```bash
docker compose pull            # or: git pull && docker compose build
docker compose up -d           # backend runs `prisma db push` before starting
```

**Kubernetes**

Bump the image tags (e.g. `2.4.0`) and apply — the backend Deployment's
`prisma-db-push` init container applies the schema before the new pods serve.

**Always back up first** for major jumps: `pg_dump anchordesk > backup.sql`
takes seconds and makes any surprise reversible.

## How it works

- **Schema** — Compose runs `npx prisma db push --skip-generate` as the
  backend command prefix; Kubernetes uses an init container with the same
  command. Schema changes in AnchorDesk releases are additive (new tables,
  new nullable columns), so pushes are non-destructive.
- **Data** — `backend/src/db/dataMigrations.ts` runs at every boot and
  applies idempotent data fixes (each is a no-op once applied). This is how
  historical inconsistencies get healed without manual SQL.

## Version notes

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
