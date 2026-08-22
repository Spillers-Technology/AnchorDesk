# AnchorDesk 2.2.0 — Clock & Compass (minor)

Clock & Compass gives service work a clear promise date and brings the context
already stored in AnchorDesk into the views technicians use every day. It also
modernizes the backend and web foundations while keeping Node.js 22.12+ and the
local-first PostgreSQL model unchanged.

## Manual deadlines with explicit precedence

- Tickets gain an optional, indexed `dueAt` manual deadline. It can exist with
  or without an SLA policy and survives priority/company edits that recompute
  policy-derived targets.
- A manual deadline replaces only the effective **resolution** target. The
  response deadline continues to run until the first qualifying response;
  clearing `dueAt` immediately falls back to `resolutionDueAt`.
- The ticket cockpit provides a phone-safe date/time editor and clear action.
  SLA chips identify the active manual clock, and the virtualized table adds a
  Due column that distinguishes manual dates from SLA dates.
- REST callers may send an ISO 8601 `dueAt` on `POST /tickets` or
  `PATCH /tickets/:id`; `null` clears it on update. MCP `create_ticket` and
  `update_ticket` expose the same contract under the connection user's normal
  RBAC and audit identity.
- SLA warning/breach evaluation and automation context use the effective
  deadline, so notifications and rules agree with the date shown in the UI.

## More signal on the read side

- Team queues now render on ticket cards and in a dedicated table column, not
  only inside the edit form.
- Every active custom-field definition becomes a formatted virtualized-table
  column and a typed advanced-search control. The client sends exact-match
  filters as `cf.<key>=<value>`; the backend validates the definition, coerces
  number/boolean values, and builds PostgreSQL `jsonb` predicates. Unknown or
  invalid filters return 400 instead of silently matching nothing.
- Saved views preserve both team and custom-field filters, so reopening a view
  reproduces the same queue slice.
- Timeline notes and revision history now turn `automation:<rule>` attribution
  into a named Automation badge. Rule-driven work stays visibly distinct from
  human changes without losing the underlying audit actor.

## Board and network lifts

- Kanban columns have direct drag handles. Reordering persists through the
  existing per-user Kanban preference, while ticket dragging continues to move
  work between statuses.
- The selected-device panel in Network lists every `DeviceExternalRef`, with
  provider labels and external IDs, so a merged Tactical/NinjaOne/Datto/probe
  record can be understood without switching to Admin.
- Canvas nodes add device-type emoji for servers, workstations, storage,
  printers, cameras, network gear, and other common classes. Color, text labels,
  status rings, and tooltips remain in place, so identity never depends on an
  emoji alone.

## Runtime and dependency modernization

### Backend

- Fastify 5 and compatible `@fastify/*` plugin majors move in lockstep. The
  unused Fastify autoload dependency is gone; WebSocket handlers use the
  Fastify 5 socket contract, and MCP's long-lived/raw response paths explicitly
  hijack the reply.
- otplib 13 and dotenv 17 land with current backend dependency minors.
- TypeScript 7 is the required backend compiler. Development runs through
  `tsx`; Jest 30 uses `@swc/jest` to transpile TypeScript tests, while
  `npm run build` remains the type-checking gate.

### Web client

- React 19 and React DOM 19.
- React Router 7.
- Vite 8, `@vitejs/plugin-react` 6, and Vitest 4.
- Material UI 9, icons 9, and Data Grid 9, including the new set-based row
  selection model used by bulk ticket selection.

## Mobile verification contract

- The shared mock API now carries a manual deadline, named automation activity,
  provider references, device types, and team/custom-field values through the
  same states used by the release UI.
- The five-device capture matrix adds the advanced-search dialog and ticket
  revision history, bringing the documented matrix to 95 screenshots across
  344–717px touch profiles.
- The phone-width Vitest guard covers Advanced search and the full ticket
  cockpit in addition to Create ticket and Run script.

## Upgrade

The 2.2 schema change is additive: one nullable, indexed `tickets.due_at`
column. Existing SLA policy dates, tickets, saved views, custom fields, team
assignments, and device references remain intact.

```bash
git pull
cd backend
npm ci
npx prisma validate
npx prisma generate
npx prisma db push
cd ../web-client
npm ci
```

Then rebuild or restart the normal deployment. Docker Compose applies
`prisma db push` when the backend starts; Kubernetes deployments should retain
their schema-application init container.

Container tags for this release:

- `ghcr.io/spillers-technology/anchordesk-backend:2.2.0`
- `ghcr.io/spillers-technology/anchordesk-web-client:2.2.0`

## Verification target

- Backend: Prisma validation/client generation, Jest 30, and the TypeScript 7
  production build on Node.js 22.12 or newer.
- Web client: Vitest 4, ESLint with zero warnings, TypeScript, and the Vite 8
  production build.
- UI: mocked desktop captures plus the five-device mobile matrix, with manual
  touch checks for ticket/column drag, map pinch zoom, and date-time input.
- Deployment: both Docker images build, the additive schema applies to a fresh
  PostgreSQL database, and the backend health check succeeds.
