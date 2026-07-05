# AnchorDesk 1.14.0 — Open Channels (minor)

AnchorDesk opens new channels to the outside world: two more **RMMs** (NinjaOne
and Datto) for device sync and script runs, and **two-way ticket sync** with
ConnectWise Manage and Jira Cloud so external tickets are editable here and flow
back out — with conflict detection that holds rather than clobbers.

> ## ⚠️ Alpha
>
> Both integrations in this release are written against the vendors' **published
> APIs** but have **not been exercised against live tenants** — we had no
> credentials at release time. The architecture (Strategy providers + registry,
> the reconcile/conflict engine) is stable and fully type-checked and tested, but
> treat the following as **experimental** until you connect real accounts:
>
> - **Most likely to need tuning:** NinjaOne token path/scopes; Datto component
>   UIDs and job polling; ConnectWise assignee write-back (`resources`); Jira
>   status transitions and assignee-by-accountId.
> - Everything is config-gated and off by default, so shipping this does not
>   affect existing installs until an integration is configured.

## Added

### NinjaOne & Datto RMM — device sync + scripts (alpha)

- Both join **Tactical RMM** behind a new **RMM registry** (`src/rmm/registry.ts`)
  that maps a device source (`tactical_rmm` / `ninjaone` / `datto_rmm`) to an
  adapter bundling config-check + `DeviceProvider` + script catalogue + live
  snapshot. The status / scripts / sync / live routes are now provider-agnostic
  and default to Tactical for back-compat.
- **NinjaOne** — OAuth2 client-credentials (cached token), device sync, and runs
  saved automation scripts by id.
- **Datto RMM** — OAuth2 password grant against the fixed public client, paged
  device sync, and asynchronous **quick jobs** (queue a component UID, poll the
  job). Datto exposes no script catalogue over the API, so the run dialog collects
  a component UID by hand.
- DB-backed config in **Admin → Integrations** for both, env seeds, sync badges,
  and per-provider "Sync from …" buttons.

### Two-way ticket sync — ConnectWise Manage & Jira Cloud (alpha)

- External tickets sync **both directions** and stay visible as external, badged
  by sync state (`synced` / `pending` / `conflict` / `error`).
- `TicketProvider` gained `canWriteBack` + `getTicket` / `updateTicket` /
  `pushNote`. **ConnectWiseProvider** implements the outbound side (JSON-Patch
  fields + notes); a new **JiraProvider** covers Jira Cloud v3 (ADF bodies,
  email + API-token auth, status via the transitions API).
- **`services/twoWaySync.ts`** owns the reconcile with a `remoteHash` fingerprint.
  A local edit marks the ticket `pending` and pushes status/priority/assignee +
  any unsynced notes.
- **Conflict policy — flag & hold.** If the remote also changed since the last
  clean sync, the ticket is flagged `conflict` and auto-sync pauses until a human
  resolves it (**keep local** or **keep remote**). New endpoints
  `POST /tickets/:id/sync` (reconcile now) and `POST /tickets/:id/resolve-conflict`.
- Batch sync routes two-way providers through the reconcile instead of the blind
  inbound overwrite used for read-only sources. Jira is configurable in
  **Admin → Integrations** and selectable in the **Sync** view.

## Changed

- **CI/CD for the new org.** The repo moved to `Spillers-Technology`, whose Actions
  runners are an **ARC scale set** labelled `arc-org` — scale-set runners answer
  only to their own name label, never the classic `self-hosted`, so CI/CD were
  switched to `runs-on: arc-org`. The GHCR image path moved to the org namespace
  (`ghcr.io/spillers-technology/anchordesk-*`).
- **Deploy is GitOps now.** The compose-on-a-runner `CD.yml` was **removed**;
  deployment flows through the GitOps/kustomize path (GHCR image → manifest),
  which fits the ephemeral ARC runners (they have no local Docker/compose).

## Upgrade notes

- **Schema change — run `prisma db push`.** This release adds enum values
  (`SyncState`; `jira` / `ninjaone` / `datto_rmm` to the ticket/provider/device
  source enums) and four `Ticket` columns (`sync_state`, `synced_at`,
  `remote_hash`, `remote_updated_at`). `prisma db push` (or a migration) is
  required; it is additive and safe on existing data.
- No behaviour changes for existing installs until an RMM or ticket integration is
  configured — all new providers are off until credentials are set.

## Validation

- Backend and web-client: TypeScript builds pass; **83 backend tests pass**
  (including new unit tests for the RMM normalizers, the two-way `fingerprint`,
  and the Jira ADF helpers).
- **Not** validated against live NinjaOne / Datto / ConnectWise / Jira tenants —
  see the Alpha note above.

## Images

- `ghcr.io/spillers-technology/anchordesk-backend:1.14.0`
- `ghcr.io/spillers-technology/anchordesk-web-client:1.14.0`
