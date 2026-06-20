# materialticket v1.0.0 — first public release

**A local-first ticketing platform for MSPs and IT teams — that also sees and acts on the machines behind the tickets.**

materialticket is a self-hosted helpdesk where your local **MariaDB database is the source of truth**. External platforms — ConnectWise Manage, IMAP mailboxes, RMM tools — are sync adapters that feed into the local store, not the core. Run it completely standalone, or wire in as many integrations as you need.

## Highlights

- **Local-first ticketing** — full CRUD, statuses, priorities, assignees, time entries, and a Kanban board. No external dependency required.
- **Full audit trail** — every mutation writes a before/after snapshot to an append-only log. Per-ticket revision history and attribution, built in.
- **Device inventory** — LAN probes (netviz) push discovered devices into your database; link them to tickets so a card shows the machine and whether it's online.
- **Act on machines** — queue and schedule scripts against devices through your RMM (Tactical RMM) directly from a ticket.
- **Pluggable sync** — ConnectWise and mail adapters sit behind Strategy/Repository boundaries; adding an integration is a new class, not a rewrite.
- **OIDC authentication** — delegated to any OIDC IdP (Azure AD, Authentik, …). No passwords stored locally.
- **Built-in MCP server** — lets agents like Claude Code read and manage tickets.
- **Ship anywhere** — Docker Compose, Kubernetes manifests, and prebuilt images on GHCR.

## Getting started

```bash
docker compose up -d db adminer
cp backend/.env.example backend/.env        # set DATABASE_URL, OIDC_DISABLED=true for local dev
cd backend && npx prisma db push && npm install && npm start
cd ../web-client && npm install && npm run dev   # http://localhost:5173
```

Prebuilt images: `ghcr.io/spilloid/materialticket-backend:1.0.0`, `ghcr.io/spilloid/materialticket-web-client:1.0.0`.

See the [README](https://github.com/spilloid/MaterialTicket#readme) and [docs/](https://github.com/spilloid/MaterialTicket/tree/main/docs) for full setup, configuration, and architecture.

## Notes

- Stack: React + MUI · Fastify + TypeScript · Prisma · MariaDB
- License: MIT
