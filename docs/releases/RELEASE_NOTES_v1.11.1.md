# AnchorDesk 1.11.1 — Switchboard (patch)

A small compatibility patch so the AVR phone agent can write back to tickets.

## Added

- **`internal` note type.** `NoteType` gains an `internal` value for
  system/agent-generated internal notes. The motivating case is the AVR phone
  receptionist posting an end-of-call summary through the REST API
  (`POST /api/tickets/:id/notes` with `noteType: "internal"`). That note
  previously failed because the value wasn't in the enum. Internal notes render
  like standard internal notes in the timeline today.

## Context

The AVR phone agent integrates over the **REST API** (not MCP), authenticating
as a technician-role service account with a **personal access token** (added in
1.10.0). The `api` ticket source the agent stamps on new tickets was already a
valid `TicketSource` value, so the only schema gap was the note type.

## Upgrade notes

- **Schema change** (enum value added). Docker Compose / the k8s `prisma db push`
  init container apply it on startup; for a manual deploy run `npx prisma db push`
  (or `npx prisma migrate deploy`) before starting the backend.
- Drop-in from 1.11.0 otherwise.

## Validation

- Backend: 63 tests passed; TypeScript build passed.
- Web: 3 tests passed; TypeScript and Vite production build passed.

## Images

- `ghcr.io/spilloid/anchordesk-backend:1.11.1`
- `ghcr.io/spilloid/anchordesk-web-client:1.11.1`
