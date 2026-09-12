# AnchorDesk 2.9.0 — True Bearing (minor)

Two kinds of honesty, one release. The schema now moves through **versioned,
recorded migrations** instead of `db push`, and the documentation, site, and
upgrade guide now say exactly what AnchorDesk is — including where it is still
alpha, what it costs, and how to get your data back.

## Versioned migrations, adopted safely

Until now every install applied its schema with `prisma db push`, which makes
the database match whatever image is running — forwards *or backwards*.
2.9.0 applies committed migrations through `backend/scripts/apply-schema.mjs`
and `prisma migrate deploy`, recording each one in `_prisma_migrations`.

The first 2.9.0 start adopts your existing database as the `0_init` baseline —
but only after proving it really is the 2.8 schema, two ways. It diffs the live
database against a frozen copy of the 2.8 datamodel (tables, columns, types,
defaults, enums, keys), **and** checks the catalog for the objects that diff
cannot see at all: CHECK constraints, the append-only triggers, and the
identity of the two indexes AnchorDesk creates itself at boot. Anything else —
a 2.7 install, a hand-altered schema, an unrelated database — is **refused,
with the differences listed and nothing written**.

An adoption interrupted part-way is safe: the next start re-runs both checks
and finishes, rather than applying the baseline over a populated database.

- **From 2.8.0, 2.8.1, or 2.8.2:** pull and restart. No schema or row changes.
- **From 2.7.x or earlier:** upgrade to 2.8.2 first, confirm it starts, then 2.9.0.
- **If your own init container or entrypoint runs `db push --accept-data-loss`,**
  replace it with `node scripts/apply-schema.mjs`.

Proven on every CI run against real databases built by the published 2.7.2,
2.8.0, and 2.8.2 images (`scripts/verify-baseline-upgrade.mjs`, 51 checks,
including rows and the full catalog surviving both adoption and refusal
untouched). The gate was adversarially reviewed before release; every finding
that review produced is fixed and has a test. Rolling back
to 2.8.2 by image swap is safe for this transition: 2.9.0 adds no schema beyond
2.8, and the 2.8.2 image leaves `_prisma_migrations` and your data intact.

## Documentation that matches the product

- **README** leads with what actually ships (portal, reporting, knowledge base,
  CSAT, merge, sync health) and an **integration-maturity table**: Jira Cloud
  beta; ConnectWise Manage, NinjaOne, and Datto RMM alpha.
- **The site** stops calling ConnectWise "Available" — it has never been
  exercised against a live tenant, and its connection test says so. The
  managed-hosting offer is withdrawn: it waits on these migrations and a
  rehearsed restore path. A **Pricing** section states the answer: the software
  is free; deployment support is quoted; one design-partner opening.
- **[SECURITY.md](https://github.com/Spillers-Technology/AnchorDesk/blob/main/SECURITY.md)** — supported versions, how to report a
  vulnerability, and known limitations stated plainly (integration credentials
  are stored in plaintext; rate limiting is per process; no proxy trust).
- **[Backup and restore](https://github.com/Spillers-Technology/AnchorDesk/blob/main/docs/backup-restore.md)** — the four things a
  restore needs (database, attachment bytes, `ENCRYPTION_KEY`,
  `AUTH_SESSION_SECRET`), with every Compose command rehearsed against a
  seeded install.
- **[Upgrading](https://github.com/Spillers-Technology/AnchorDesk/blob/main/docs/upgrading.md)** gains the missing 2.6–2.8 notes and
  corrects rollback: starting an older (≤2.8.x) image against a newer database
  drops the newer tables — silently if they are empty, with their data under
  `--accept-data-loss`. Roll back by restoring the pre-upgrade backup.

## Known issues carried forward

- The example Kubernetes manifests store local attachments without a volume;
  use S3 or mount a volume at `/backend/data/attachments`.
- The Tactical RMM, NinjaOne, and Datto admin cards can show "configured"
  before their secret is saved (#36).

## Upgrading

Back up first ([backup-restore.md](https://github.com/Spillers-Technology/AnchorDesk/blob/main/docs/backup-restore.md)), then pull and
restart. The backend logs `Schema matches AnchorDesk 2.8.x; marking 0_init as
applied.` once, then `No pending migrations to apply.` on every later start.
