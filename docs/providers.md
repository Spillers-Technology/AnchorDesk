# Adding Sync Providers

## Ticket providers

anchordesk uses the **Strategy pattern** for external integrations. Each provider implements the `TicketProvider` interface, and the sync service calls it without knowing which platform it's talking to.

---

## The interface

```typescript
// backend/src/providers/TicketProvider.ts

interface TicketProvider {
  readonly name: string;
  readonly canWriteBack?: boolean;
  readonly writableFields?: ReadonlyArray<keyof TicketWriteback>;
  fetchTickets(since?: Date): Promise<ExternalTicket[]>;
  getTicket?(externalTicketId: string): Promise<ExternalTicket | null>;
  fetchNotes(externalTicketId: string): Promise<ExternalNote[]>;
  pushTicket?(ticket: { title: string; description?: string; companyName?: string }): Promise<string>;
  updateTicket?(externalTicketId: string, changes: TicketWriteback): Promise<void>;
  pushNote?(externalTicketId: string, note: { content: string; author: string }): Promise<string | void>;
}
```

`ExternalTicket` and `ExternalNote` are normalized shapes — your provider translates from the platform's API format into these.

---

## Step-by-step

### 1. Create your provider class

```typescript
// backend/src/providers/MyPlatformProvider.ts

import { TicketProvider, ExternalTicket, ExternalNote } from './TicketProvider';

export class MyPlatformProvider implements TicketProvider {
  readonly name = 'myplatform';

  async fetchTickets(since?: Date): Promise<ExternalTicket[]> {
    // Call your platform's API
    const raw = await myPlatformClient.getTickets({ updatedAfter: since });

    return raw.map((t) => ({
      externalId: String(t.id),
      title: t.subject,
      summary: t.subject,
      description: t.body,
      status: t.state,
      companyName: t.organization?.name,
    }));
  }

  async fetchNotes(externalTicketId: string): Promise<ExternalNote[]> {
    const raw = await myPlatformClient.getComments(externalTicketId);

    return raw.map((n) => ({
      externalId: String(n.id),
      content: n.body,
      author: n.author.name,
      noteType: 'note',
    }));
  }
}
```

### 2. Add the provider type to the schema

In `backend/prisma/schema.prisma`, add your platform to the `ProviderType` enum:

```prisma
enum ProviderType {
  connectwise
  jira
  imap
  tactical_rmm
  ninjaone
  datto_rmm
  meshcentral
  netviz
  myplatform   // ← add this
}
```

Then push the schema change:

```bash
cd backend && npx prisma db push
```

### 3. Configure a provider instance

For supported ticket-provider types, use **Admin → Ticket Sync** to manage the
account connection, create/edit scope and filters, test credentials, run jobs,
and inspect durable health/history. Today the UI exposes `connectwise` and
`jira`; Jira credentials live in a first-class `Connection`, while ConnectWise
stays on its legacy singleton until its client is de-singletoned. Add your
provider to the route allowlists and UI selector before exposing it. The job API
is:

```http
POST /sync/providers
Content-Type: application/json

{
  "name": "My Platform",
  "type": "myplatform",
  "enabled": true,
  "connectionId": 12,
  "config": {
    "board": "Support"
  }
}
```

Credentials belong in a `Connection` record, not in the provider row. The job's
`config` is safe non-secret scope/filter data. If the remote account is part of
ticket identity, keep its immutable identity fields separate from rotatable
credentials; Jira's site URL, for example, cannot be changed after creation.
Never choose a connection implicitly: the Jira job must persist the exact
`connectionId` it may read and write. Starts are serialized per external
account, so multiple filtered jobs on one connection do not race the same
outbound backlog.

### 4. Wire into the sync service

The sync service instantiates providers via a factory based on
`sync_providers.type`. Register your ticket provider in the factory:

```typescript
// backend/src/providers/ticketProviderFactory.ts

export function createTicketProvider(
  type: string,
  cfg: Record<string, unknown> = {},
  credentials: ProviderCredentials = {}
): TicketProvider {
  switch (type) {
    case 'connectwise': return new ConnectWiseProvider((cfg.board as string) ?? undefined);
    case 'jira':        return new JiraProvider(
      jiraService.credentialsFrom(credentials),
      cfg.jql as string | undefined,
      parseSyncFilter(cfg.filter),
      cfg.projectKey as string | undefined
    );
    case 'myplatform':  return new MyPlatformProvider(cfg);
    // ...
  }
}
```

---

## Notes

- `externalId` + provider type + connection identity must be stable across
  syncs. Two tenants can both have `HELP-1`; never deduplicate globally by
  provider type alone.
- For two-way sync, set `canWriteBack = true` and implement `getTicket`, `updateTicket`, and `pushNote`
- `pushTicket` is optional and only needed when the provider can create a new remote ticket from a local ticket
- Every attempt is a `SyncRun`; record activity is linked in `sync_log`.
- If your platform doesn't paginate the same way, handle pagination internally in `fetchTickets` and return a flat array
- Add the new provider type to the connection/job route allowlists before
  exposing it in Admin → Ticket Sync.

---

## Merge and hierarchy contract

Ticket merge and parent/child hierarchy are local-record operations in 2.6.
Providers must never push or pull either relation. A merged source stops
reconciling and returns the outcome `merged`, deliberately distinct from
`skipped`: leaving a tombstone alone is expected behavior and must not degrade
run health.

Do not map merge to a remote close, comment, duplicate link, subtask, or parent
field. Provider link and hierarchy mapping belongs to the 3.0 `TicketLink` work;
until that lands, provider authors must leave both features local-only.

---

## Device and RMM providers (2.1.0)

Device integrations implement `DeviceProvider` and normalize provider payloads
to `ExternalDevice`. In addition to operational fields, the normalized contract
can supply `assetTag`, `serialNumber`, `manufacturer`, `model`, `location`,
`purchaseDate`, `warrantyExpiresAt`, and `notes`.

Keep the provider `name` and every `externalId` stable. AnchorDesk stores that
pair in `DeviceExternalRef`, so Tactical RMM, NinjaOne, Datto RMM, netviz, and
future sources can all refer to one local `Device`. The legacy external columns
on the device mirror its primary reference for older clients.

Use the device repository's external upsert path instead of creating rows
directly. Identity resolution is deliberately ordered:

1. exact provider + external id;
2. normalized MAC address;
3. serial number plus company;
4. hostname plus company;
5. create a new local device only when none match.

A supplied MAC or scoped serial is a strong identity: when it does not match,
sync creates a new record instead of weakening the comparison to hostname.

This merge policy protects ticket links and locally curated asset data. Provider
telemetry may fill missing canonical values, but a periodic sync must not erase
the local asset tag, location, lifecycle dates, or notes simply because a remote
API omitted them.

For an RMM that supports live data or scripts, also register an `RmmAdapter` in
`backend/src/rmm/registry.ts` and a matching `ScriptRunner`. Live lookups accept
`GET /devices/:id/live?provider=<key>` and script-run requests may select a
provider; resolve the external id from that device's reference rather than
assuming its primary source.
