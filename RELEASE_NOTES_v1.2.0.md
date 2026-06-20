# AnchorDesk v1.2.0 — rebrand, email-to-ticket, and an Admin console

This release renames the project to **AnchorDesk** (formerly materialticket) and
lands inbound email-to-ticket, in-app integration management, a redesigned Admin
console, and a top-to-bottom Material UX lift.

## ⚠️ Upgrade notes

- **Rebrand to AnchorDesk.** Package names, Docker image names
  (`ghcr.io/spilloid/anchordesk-backend`, `-web-client`), the k8s namespace
  (`anchordesk`), and the default database name (`anchordesk`) all changed. Update
  your `DATABASE_URL` database name and k8s references. No data migration is
  provided — point at a fresh `anchordesk` database and run `prisma db push`.
- The repository moved to **github.com/spilloid/AnchorDesk**.

## Highlights

- **📥 Email-to-ticket (IMAP).** Configure mailboxes in **Admin → Mailboxes**;
  AnchorDesk polls them, opens a ticket per new message, and **threads replies**
  into the original ticket as notes (matched on `In-Reply-To`/`References`).
  Mailbox passwords are stored **AES-256-GCM encrypted**.
- **🔌 Integrations in the Admin UI.** SMTP, ConnectWise, and Tactical RMM are now
  editable in **Admin → Integrations** (env vars seed first boot; the DB wins
  afterward). Secrets are write-only.
- **🧭 Admin console.** A persistent left sub-nav with an **Overview** dashboard
  (live ticket/device/probe/user stats + activity feed) and a searchable
  **Audit-log viewer** over the append-only log.
- **🎫 Redesigned ticket modal.** Two-pane "cockpit": gradient header (id, status,
  priority, source), a description + activity timeline, and an integration-aware
  sidebar (linked devices with run-script, sync source, script jobs, and an inline
  email composer when SMTP is configured).
- **✨ Material UX lift.** A cohesive theme — refined palette, Inter typography,
  consistent rounding/elevation, styled tables and nav — applied app-wide.

## Fixes

- **Body-less POSTs no longer 500.** Requests sending `Content-Type: application/json`
  with an empty body (e.g. *Sync from Tactical*, logout) were throwing
  "Unexpected end of JSON input"; the JSON parser now treats an empty body as no body.
- **Probes reach the backend through the public URL.** nginx (and the Vite dev
  proxy) now proxy `/probe/*` to the backend, fixing the `405 Not Allowed` probes
  hit on heartbeat/device-ingest.
- Stale "Intune Depot" HTML title and the leftover external Docker network removed.

## Repo hygiene

- Added `.dockerignore` to both images (notably keeps `backend/.env` out of the
  image), removed the external-network requirement so `docker compose up` works
  out of the box, and named the compose project `anchordesk`.

## Notes

- Stack: React + MUI · Fastify + TypeScript · Prisma · PostgreSQL
- License: MIT
