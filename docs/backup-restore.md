# Backup and restore

AnchorDesk keeps everything that matters in PostgreSQL, but a restorable
install is **four** things, not one. Back all four up, and rehearse a restore
before you need one.

> **Last rehearsed:** 2026-09-10, against the published `2.8.2` backend image
> and PostgreSQL 16. A seeded install — ticket, attachment on local disk, IMAP
> mailbox with a stored password, reporting event, audit rows — was dumped,
> restored into an empty database, and booted. Every row count matched, the
> attachment downloaded byte-identical, the append-only reporting table
> restored cleanly, and the mailbox password decrypted with the original
> `ENCRYPTION_KEY` (and returned nothing with any other key).

## What to back up

| # | What | Where it lives | Lose it and… |
|---|---|---|---|
| 1 | **The database** | PostgreSQL | …you lose everything: tickets, notes, audit history, users, settings, reporting history, integration credentials. |
| 2 | **Attachment bytes** | `STORAGE_LOCAL_DIR` (default `./data/attachments`, i.e. `/backend/data/attachments` in the image) — or your S3 bucket | …tickets still list their files, but downloads fail. The database holds only metadata. |
| 3 | **`ENCRYPTION_KEY`** | Your `.env` / secret store | …IMAP mailbox passwords cannot be decrypted; every mailbox stops polling until its password is re-entered. |
| 4 | **`AUTH_SESSION_SECRET`** | Your `.env` / secret store | …everyone is signed out and in-flight MCP OAuth consents fail. No data is lost. |

Keep 3 and 4 in a password manager or secret store, **separately** from the
backups themselves.

### Treat every backup as a secret

The database stores Jira tokens, RMM API keys, and the SMTP password in
plaintext — only IMAP mailbox passwords are encrypted (see
[SECURITY.md](../SECURITY.md)). Anyone holding a dump holds those credentials.
Encrypt backups at rest and restrict who can read them.

### If attachments live in S3

AnchorDesk does not back up your bucket. Turn on the provider's versioning or
replication, and restore the bucket and the database **from the same point in
time** — a database newer than its bucket references files that don't exist.

## Docker Compose

The commands below run inside the `db` container, so they use the database
name and user the container was started with — no host `psql` needed. With the
repository's Compose file, local attachments land on the host at
`backend/data/attachments` (the backend bind-mounts `./backend`).

### Back up

Dump the database **first**, then copy attachments. That order guarantees every
attachment row in the dump has its file in the archive; files uploaded in
between are harmless orphans.

```bash
STAMP=$(date +%F)
VERSION=2.8.2   # the AnchorDesk version you are running — record it with the backup

docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  > "anchordesk-$VERSION-$STAMP.dump"

tar -C backend/data -czf "anchordesk-$VERSION-$STAMP-attachments.tgz" attachments
```

`pg_dump` takes a consistent snapshot while AnchorDesk keeps running; there is
no need to stop the backend.

### Restore

Restore with the **same AnchorDesk version** the backup was taken from, then
upgrade normally. An older image started against a newer database will try to
reconcile the schema backwards.

```bash
docker compose stop backend web-client

# Recreate an empty database (drops the current one — be sure).
docker compose exec -T db sh -c \
  'dropdb -U "$POSTGRES_USER" --force --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'

docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' \
  < anchordesk-2.8.2-2026-09-10.dump

mkdir -p backend/data && tar -C backend/data -xzf anchordesk-2.8.2-2026-09-10-attachments.tgz

docker compose start backend web-client
```

Make sure `backend/.env` still has the **original** `ENCRYPTION_KEY` before
starting the backend.

### Check the restore

1. `curl localhost:8060/ping` returns `pong`, and the backend log shows
   `Critical Postgres invariants and optional extras ensured`.
2. Sign in; the ticket list total matches what you expect.
3. Open a ticket with an attachment and download it.
4. Admin → Mailboxes: each mailbox still shows a stored password, and the next
   poll succeeds. A mailbox that fails to authenticate after a restore almost
   always means a different `ENCRYPTION_KEY`.

## Kubernetes

- **Attachments: the example manifests in `k8s/dev/` use local storage with no
  volume mounted.** Files written there live in the container's filesystem and
  are lost when the pod restarts or upgrades. Before storing real attachments,
  either set `STORAGE_BACKEND=s3` (any S3-compatible store) or mount a
  PersistentVolumeClaim at `/backend/data/attachments`.
- **Database, logical dump** (the same format as the Compose path, portable
  across hosts):

  ```bash
  kubectl exec -n <namespace> db-0 -- sh -c 'pg_dump -U "$POSTGRES_USER" -Fc anchordesk' \
    > anchordesk-<version>-$(date +%F).dump
  ```

  Restore by scaling the backend to zero, recreating the database, piping the
  dump into `pg_restore` the same way, and scaling back up.
- **Database, operator-managed.** If you run PostgreSQL through an operator such
  as CloudNativePG, use its continuous backup (base backups plus WAL archiving
  to object storage, on a schedule with a retention policy) and practice
  recovery by bootstrapping a new cluster from that backup. A periodic
  `pg_dump` is still worth keeping as a portable copy that does not depend on
  the operator.

## Rehearse it

A backup you have never restored is a hope, not a backup. At least once a
quarter, and before every major upgrade:

```bash
docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" anchordesk_restore_test'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d anchordesk_restore_test --no-owner' \
  < anchordesk-2.8.2-2026-09-10.dump
docker compose exec -T db sh -c \
  'psql -U "$POSTGRES_USER" -d anchordesk_restore_test -Atc "select count(*) from tickets"'
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" anchordesk_restore_test'
```

The count should match production at the time of the dump.
