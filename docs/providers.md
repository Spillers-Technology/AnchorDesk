# Adding a New Ticket Provider

anchordesk uses the **Strategy pattern** for external integrations. Each provider implements the `TicketProvider` interface, and the sync service calls it without knowing which platform it's talking to.

---

## The interface

```typescript
// backend/src/providers/TicketProvider.ts

interface TicketProvider {
  readonly name: string;
  readonly canWriteBack?: boolean;
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

For supported ticket-provider types, use the **Sync** view to create, enable,
run, or delete provider instances. Today the UI exposes `connectwise` and
`jira`; add your provider to the route allowlist and UI selector before exposing
it. The equivalent API is:

```http
POST /sync/providers
Content-Type: application/json

{
  "name": "My Platform",
  "type": "myplatform",
  "enabled": true,
  "config": {
    "board": "Support"
  }
}
```

Credentials shared by an integration belong in **Admin → Integrations** (seeded
from environment variables), not in the provider row.

### 4. Wire into the sync service

The sync service instantiates providers via a factory based on
`sync_providers.type`. Register your ticket provider in the factory:

```typescript
// backend/src/providers/ticketProviderFactory.ts

export function createTicketProvider(type: string, cfg: Record<string, unknown> = {}): TicketProvider {
  switch (type) {
    case 'connectwise': return new ConnectWiseProvider((cfg.board as string) ?? undefined);
    case 'jira':        return new JiraProvider((cfg.jql as string) ?? undefined);
    case 'myplatform':  return new MyPlatformProvider(cfg);
    // ...
  }
}
```

---

## Notes

- `externalId` + `name` (provider name) must be stable across syncs — they're used to deduplicate records
- For two-way sync, set `canWriteBack = true` and implement `getTicket`, `updateTicket`, and `pushNote`
- `pushTicket` is optional and only needed when the provider can create a new remote ticket from a local ticket
- All sync activity is logged to `sync_log` automatically by the sync service
- If your platform doesn't paginate the same way, handle pagination internally in `fetchTickets` and return a flat array
- Add the new provider type to the create-route allowlist before exposing it in the Sync UI
