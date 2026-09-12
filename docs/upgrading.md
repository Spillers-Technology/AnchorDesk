# Upgrading AnchorDesk

AnchorDesk upgrades in place. Both deployment styles apply the schema before
the app starts, and the backend runs idempotent **data migrations on every
boot** — so for most versions, upgrading is: back up, pull the new images,
restart. Your tickets, notes, and settings live in PostgreSQL; attachment bytes
live in your configured attachment storage (see
[backup-restore.md](backup-restore.md) — the example Kubernetes manifests keep
local attachments inside the container unless you mount a volume or use S3).

## The standard procedure

**Back up first, every time** — the database, your attachments, and your
`ENCRYPTION_KEY`. [backup-restore.md](backup-restore.md) has the commands. The
pre-upgrade backup is also your only reliable rollback (see
[If something goes wrong](#if-something-goes-wrong)).

**Docker Compose**

```bash
docker compose pull            # or: git pull && docker compose build
docker compose up -d           # backend applies the schema before starting
```

**Kubernetes**

Bump the image tags and apply — the backend Deployment's init container applies
the schema before the new pods serve.

## How it works

- **Schema, from 2.9.0** — Compose runs `node scripts/apply-schema.mjs` as the
  backend command prefix; Kubernetes runs the same script in its
  `prisma-migrate` init container. It applies the committed, ordered
  migrations in `backend/prisma/migrations/` with `prisma migrate deploy` and
  records each one in `_prisma_migrations`. See
  [Moving to versioned migrations](#moving-to-versioned-migrations-290) for
  the one-time transition.
- **Schema, 2.8.2 and earlier** — Compose ran `npx prisma db push
  --skip-generate`; Kubernetes used an init container with the same command.
  `db push` makes the database match *the running image's* schema.
  It refuses any change Prisma classifies as potentially lossy — dropping a
  table or column that holds rows, or adding a unique constraint — unless
  `--accept-data-loss` is given. Most releases only add tables and nullable
  columns and push cleanly; the version notes below call out the exceptions.
- **Data** — `backend/src/db/dataMigrations.ts` runs at every boot and
  applies idempotent data fixes (each is a no-op once applied). This is how
  historical inconsistencies get healed without manual SQL.

### Do not leave `--accept-data-loss` on

When a version note tells you to accept a flagged change, run
`db push --accept-data-loss` **once**, as a supervised step against a verified
backup, then return to the plain command. Left in place permanently (for
example in an init container), it also accepts every *unintended* loss —
including the one a rollback causes, described below.

## Moving to versioned migrations (2.9.0)

2.9.0 replaces `db push` with versioned migrations. The first 2.9.0 start
*adopts* your existing database: it records the baseline migration `0_init` as
already applied, then deploys anything newer. Adoption is only correct for a
database that really is the 2.8 schema, so it is **fingerprinted first**:

- **Upgrading from 2.8.0, 2.8.1, or 2.8.2** — supported. `apply-schema.mjs`
  checks your database two ways before recording the baseline: `prisma migrate
  diff` against the frozen 2.8 datamodel
  (`backend/prisma/baseline/schema-2.8.prisma`), **and** a catalog check of the
  objects that diff cannot see — CHECK constraints, triggers, and the identity
  of the two indexes AnchorDesk creates at boot. A real 2.8.x install passes
  both and is adopted with no schema or row changes. Verified on every CI run
  against real databases built by the published 2.8.0 and 2.8.2 images
  (`scripts/verify-baseline-upgrade.mjs`).
- **Adoption runs only in the `public` schema.** An install using a different
  schema is refused rather than adopted down an untested path; ask before
  upgrading one.
- **Upgrading from 2.7.x or earlier** — upgrade to **2.8.2 first** with the
  2.8.2 image (follow the version notes below), confirm it starts, then upgrade
  to 2.9.0. Started directly against an older database, 2.9.0 refuses, lists
  the differences it found, and changes nothing.
- **A 2.8.x database someone altered by hand** is refused the same way — an
  added column, an extra CHECK constraint, a dropped trigger, or a replaced
  index all stop it. Put the schema back (starting 2.8.2 once restores the
  objects AnchorDesk creates at boot), or restore a clean backup, then retry.
- **If a previous attempt was interrupted** part-way — migration history exists
  but the baseline was never recorded — the next start re-runs both checks and
  finishes the adoption. It never deploys the baseline over a populated
  database, and a recorded *failed* migration stops it with the
  `prisma migrate resolve --rolled-back` command you need.
- **If your deployment runs `db push --accept-data-loss` in its own init
  container or entrypoint** (as the 2.6/2.7 notes suggested for one supervised
  step), replace that command with `node scripts/apply-schema.mjs` when you
  move to 2.9.0. Leaving the push in place keeps the old, unrecorded path
  running alongside the new one.

Take a backup before the first 2.9.0 start
([backup-restore.md](backup-restore.md)). Rolling 2.9.0 back to 2.8.2 by image
swap is safe — 2.9.0 adds no schema beyond 2.8, and the 2.8.2 image's
`db push` leaves `_prisma_migrations` and your data intact (tested 2026-09-10).

## Version notes

### → 2.9.0 (True Bearing — versioned migrations)
- Schema application moves from `db push` to `apply-schema.mjs` +
  `prisma migrate deploy`. No schema change: `0_init` is the 2.8 schema.
- Upgrade from 2.8.x only; see
  [Moving to versioned migrations](#moving-to-versioned-migrations-290).

### → 2.8.1 / 2.8.2 (Ledger & Log / First Coat)
- No schema, API, or data change. Pull and restart. Safe to roll back to 2.8.0
  by image swap.

### → 2.8.0 (Access & Signal)
- Adds four tables (`portal_registrations`, `portal_grants`,
  `user_portal_profiles`, `ticket_feedback`); pushes cleanly.
- **If you already run the customer portal, existing requesters need a grant
  to sign in again.** Sign-in now requires an active `PortalGrant`, and every
  existing contact starts with none. A requester who is already signed in keeps
  that session until it expires; their next sign-in fails until you grant
  access from the contact's row in Companies. Grant your active requesters
  before or right after upgrading.
- **Customer feedback and self-solve default on.** If `portal.enabled` is on,
  the upgrade makes the rating prompt and "mark as solved" live for requesters
  immediately. Turn either off under Admin → Customer Portal / Feedback first
  if you don't want that yet.
- **Notes default to internal.** A note created through the REST API or an
  integration without an explicit `visibility: "public"` is now internal and
  is not pushed to Jira/ConnectWise. Update any script that relied on the old
  inference.
- Rolling back to 2.7.x drops these tables — see
  [If something goes wrong](#if-something-goes-wrong).

### → 2.7.1 / 2.7.2 (Drafts you can find / The query nobody ran)
- No schema or data change. 2.7.2 fixes the knowledge-base list endpoints,
  which returned 500 on every 2.7.0 and 2.7.1 install; upgrade directly to it.

### → 2.7.0 (Pass the Flinch Test)
- Adds the reporting spine (`ticket_events`, `ticket_sla_snapshots`), portal,
  and knowledge-base tables. Boot runs an idempotent backfill of reporting
  events from the audit log and creates the append-only triggers as
  fail-closed invariants. Historical SLA targets are deliberately **not**
  reconstructed; reports label backfilled windows as estimates.
- `portal.enabled` defaults off — nobody gets a customer-facing surface by
  upgrading.
- Coming from 2.4.x, this upgrade also crosses 2.6.0's unique-constraint change
  (below).

### → 2.6.0 (Relations; includes the unreleased 2.5 sync work)
- **One flagged schema change.** The tickets unique constraint on
  `(external_id, external_provider)` gains `sync_connection_id`. Data that
  satisfied the old constraint always satisfies the new, looser one, but Prisma
  classifies any new unique constraint as potentially lossy, so a plain
  `db push` refuses. Take a backup, run `npx prisma db push --skip-generate
  --accept-data-loss` once (Compose: `docker compose run --rm backend npx
  prisma db push --skip-generate --accept-data-loss`), then start normally.
- Boot adopts existing Jira credentials from Admin → Integrations as a Jira
  **Connection** and attaches existing Jira sync jobs to it. ConnectWise stays
  a single legacy account. Ticket sync moves from the top-level Sync view to
  Admin → Ticket sync.
- Boot creates the one-level hierarchy trigger and the live-merge-ledger unique
  index as fail-closed startup invariants.

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

**Restore the pre-upgrade backup with the previous image. Do not simply start
a 2.8.x-or-earlier image against a database a newer release changed.** Those
images run their own `db push`, which reconciles the database *backwards* to
the older schema.
Tested on 2026-09-10 by starting the `2.7.2` image against a `2.8.0` database:

| Push command | Newer tables | Result |
|---|---|---|
| plain `db push` (Compose default) | empty | the newer tables are **dropped silently**; boot continues |
| plain `db push` | hold rows | the push **refuses** and the backend does not start |
| `db push --accept-data-loss` | hold rows | the newer tables are **dropped with their data** |

Rolling back is only a plain image swap when the newer release changed no
schema — 2.9.0 → 2.8.x, 2.8.2 → 2.8.1 → 2.8.0, and 2.7.2 → 2.7.1 → 2.7.0
qualify. For
anything else, stop the backend, restore the backup you took before upgrading
([backup-restore.md](backup-restore.md)), and start the previous image.
