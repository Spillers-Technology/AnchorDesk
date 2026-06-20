# Adding a New Ticket Provider

anchordesk uses the **Strategy pattern** for external integrations. Each provider implements the `TicketProvider` interface, and the sync service calls it without knowing which platform it's talking to.

---

## The interface

```typescript
// backend/src/providers/TicketProvider.ts

interface TicketProvider {
  readonly name: string;
  fetchTickets(since?: Date): Promise<ExternalTicket[]>;
  fetchNotes(externalTicketId: string): Promise<ExternalNote[]>;
  pushTicket?(ticket: ...): Promise<string>;   // optional — outbound only
  pushNote?(externalTicketId: string, note: ...): Promise<void>;  // optional
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
  imap
  tactical_rmm
  meshcentral
  myplatform   // ← add this
}
```

Then push the schema change:

```bash
cd backend && npx prisma db push
```

### 3. Configure a provider instance

Insert a row into the `sync_providers` table (via Adminer, Prisma Studio, or a seed script):

```sql
INSERT INTO sync_providers (name, type, config, enabled)
VALUES (
  'My Platform',
  'myplatform',
  '{"apiKey": "...", "baseUrl": "https://myplatform.example.com"}',
  1
);
```

### 4. Wire into the sync service (Phase 3)

When the sync service is implemented, it will instantiate providers via a factory based on `sync_providers.type`. You'll register your provider in the factory:

```typescript
// backend/src/services/syncService.ts (future)

function createProvider(row: SyncProvider): TicketProvider {
  switch (row.type) {
    case 'connectwise': return new ConnectWiseProvider(row.config);
    case 'myplatform':  return new MyPlatformProvider(row.config);
    // ...
  }
}
```

---

## Notes

- `externalId` + `name` (provider name) must be stable across syncs — they're used to deduplicate records
- The `pushTicket` / `pushNote` methods are optional — implement them only if outbound sync is needed
- All sync activity is logged to `sync_log` automatically by the sync service
- If your platform doesn't paginate the same way, handle pagination internally in `fetchTickets` and return a flat array
