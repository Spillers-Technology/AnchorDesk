# AnchorDesk 2.1.0 — Pocket & Anchor (minor)

Pocket & Anchor makes AnchorDesk useful wherever the work happens. The web
client is now a phone-ready field tool, while teams, custom fields,
automations, saved views, and richer device records close the largest workflow
gaps identified in the Zammad, Autotask, and Jira Service Management audit.

## Mobile-first, not mobile-afterthought

- The board, ticket cockpit, mail composer, admin console, companies, network,
  sync, and My Day views remain usable down to a 344px folded-cover viewport.
- Core dialogs become full-screen on phones, shell spacing and typography scale
  down cleanly, and wide boards scroll inside their own container instead of
  widening the page.
- Touch users get visible card actions, two-finger network-map zoom, and
  on-screen zoom/reset controls; pointer cancellation and reduced motion remain
  supported.
- A shared mock API drives desktop captures and a five-device Playwright matrix,
  including the new workflow dialogs and admin sections. Vitest guards the
  full-screen dialog contract in CI.

## Queues, fields, and personal workspaces

- **Teams** provide a real queue/group assignment independent of the individual
  technician. Admins manage team membership; tickets, filters, views, and
  automations can route or target a team.
- **Custom ticket fields** support text, number, boolean, date, and select
  definitions. Values are validated centrally and stored as JSON on the ticket;
  archived definitions preserve existing data without accepting new values.
- **Saved views** persist personal filter sets, while admins can publish shared
  views. Ticket filtering now includes teams alongside status, assignee,
  company, label, text, and closed-ticket visibility.
- Each user can choose and order the status columns shown on their Kanban board.

## Automation and SLA escalation

- Event-driven rules can react to ticket creation or update, new notes, and SLA
  warning or breach events.
- All-of conditions cover normal ticket fields, labels, teams, custom fields,
  and SLA context with equality, containment, membership, numeric comparison,
  and set/unset operators.
- Ordered actions can change status or priority, assign a user or team, add a
  label or note, and notify a user or every member of a team.
- Actions use the normal repositories, remain actor-attributed in the audit log,
  update the live UI, and carry a loop guard so automation cannot recursively
  trigger itself.

## MCP workflow coverage

- Ticket creation and updates accept `teamId` and validated `customFields`.
- Agents can search tickets, read ticket history, list and apply labels, list
  teams and custom-field definitions, and replay the current user's personal or
  shared saved views.
- Every MCP connection still acts as its approving user, with the same RBAC,
  audit attribution, personal-token revocation, and built-in OAuth flow.

## Configuration records across multiple RMMs

- Device inventory adds asset tag, serial number, manufacturer, model, location,
  purchase date, warranty expiry, and free-form notes while retaining vendor and
  operational telemetry.
- `DeviceExternalRef` records let one physical device keep a provider-specific
  identity for Tactical RMM, NinjaOne, Datto RMM, netviz, or future adapters.
- Sync resolves an existing external reference first, then safely falls back to
  MAC, company-scoped serial number, or hostname plus company before creating a
  device. A sync refresh fills operational data without overwriting locally
  maintained asset fields.
- Live lookups and script runs can select a provider when a device has multiple
  references. Scheduled runs pin that provider-specific target, and explicit
  provider requests never fall back to a different RMM. The legacy
  `externalProvider`/`externalId` pair remains the primary compatibility
  reference for existing installs and clients and is backfilled on startup.

## Upgrade

This release has additive schema changes: new team, custom-field, automation,
saved-view, and device-external-reference tables; ticket team/custom-field
columns; a user Kanban preference; device asset columns; and a pinned external
target on scheduled script jobs. Apply the Prisma schema before starting the
new backend:

```bash
git pull
cd backend
npm ci
npx prisma generate
npx prisma db push
cd ../web-client
npm ci
```

Then rebuild or restart the normal deployment. Docker Compose applies
`prisma db push` when the backend starts; Kubernetes deployments should retain
their schema-application init container. Existing tickets, devices, legacy RMM
references, and custom-field data are preserved.

Container tags for this release:

- `ghcr.io/spillers-technology/anchordesk-backend:2.1.0`
- `ghcr.io/spillers-technology/anchordesk-web-client:2.1.0`

## Verification target

- Backend: Prisma validation/client generation, TypeScript build, and Jest.
- Web client: Vitest, ESLint with zero warnings, TypeScript, and production Vite
  build on the Node.js 22 CI baseline.
- Deployment: both Docker images build, the schema applies to a fresh
  PostgreSQL database, and the backend health check succeeds.
- UI: desktop drive plus the five-device mobile matrix, with manual touch checks
  for Kanban drag, network pinch zoom, and the on-screen keyboard.
