# Baseline adoption: 2.8.x `db push` installs → versioned migrations

Before versioned migrations, every AnchorDesk install built its schema with
`prisma db push`. `scripts/apply-schema.mjs` adopts such an install by
recording `0_init` as already applied — which is only true if the database
really is the schema `0_init` creates.

- **`schema-2.8.prisma`** — the 2.8 datamodel, frozen byte-for-byte from the
  `v2.8.2` tag. `0_init/migration.sql` is exactly this datamodel (CI checks it
  on every push). It never changes: later schema work goes into new
  migrations, not here.
- **Eligibility is the 2.8.x line only.** `apply-schema.mjs` diffs the live
  database against `schema-2.8.prisma` and refuses unless the only differences
  are the two B-tree indexes `pgExtras.ts` creates beyond `schema.prisma`
  (`idx_ticket_events_assignee_occurred`, `idx_ticket_events_team_occurred`).
  Prisma's diff does not model the other pgExtras objects (extensions,
  GIN/partial/functional indexes, CHECK constraints, triggers) at all.
  Older installs upgrade to 2.8.2 first with the 2.8.2 image, then continue.

## Fixtures

Schema-only `pg_dump`s of databases built by the **published** backend images,
exactly as a deployment builds them: `npx prisma db push --skip-generate
--accept-data-loss` from the image, then one boot of the image so
`pgExtras.ts` and the boot data migrations run. PostgreSQL 16. No rows.

| File | Built from | Role in `scripts/verify-baseline-upgrade.mjs` |
|---|---|---|
| `fixtures/installed-2.8.x.schema.sql` | `anchordesk-backend:2.8.0` **and** `:2.8.2` | Must be adopted, rows and schema unchanged |
| `fixtures/installed-2.7.2.schema.sql` | `anchordesk-backend:2.7.2` | Must be refused, nothing written |

The 2.8.0 and 2.8.2 dumps were byte-identical when generated on 2026-09-10
(sha256 prefix `0cb55ef7f860f259` for both), so one file stands for the whole
2.8.x line. 2.8.1 changed no schema.

### Regenerating a fixture

```bash
V=2.8.2; DB=adk_fixture; URL=postgresql://adk:adk@127.0.0.1:5432/$DB
docker run -d --name fx-pg -p 5432:5432 -e POSTGRES_USER=adk -e POSTGRES_PASSWORD=adk postgres:16-alpine
docker exec fx-pg createdb -U adk $DB
docker run --rm --network host -e DATABASE_URL=$URL \
  ghcr.io/spillers-technology/anchordesk-backend:$V npx prisma db push --skip-generate --accept-data-loss
# Boot once so pgExtras + data migrations run; stop it after "listening on".
docker run --rm --network host -e DATABASE_URL=$URL -e SERVER_PORT=18060 \
  -e AUTH_SESSION_SECRET=$(openssl rand -hex 32) -e ENCRYPTION_KEY=$(openssl rand -hex 32) \
  ghcr.io/spillers-technology/anchordesk-backend:$V
docker exec fx-pg pg_dump -U adk --schema-only --no-owner --no-privileges --no-comments $DB \
  | grep -v -E '^-- Dumped (from|by)|^\\(un)?restrict ' > fixtures/installed-$V.schema.sql
```

The `grep` drops the tool-version comments and the `\restrict` meta-commands
newer `pg_dump` builds emit, which older `psql` clients reject.
