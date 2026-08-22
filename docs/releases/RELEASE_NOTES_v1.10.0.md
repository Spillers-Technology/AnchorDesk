# AnchorDesk 1.10.0 — Keys & Trails

Hand your automations a key of their own. This release gives AnchorDesk
**personal access tokens** so credential-limited clients — an MCP voice agent,
a script, anything that can't sit through an interactive or SSO login — can act
*as a real person*, and makes every action they take show up under that person
in the audit trail, tagged with how it came in.

## Added

- **Personal access tokens (PATs).** Mint and revoke your own tokens from the
  account menu → **API tokens**. The raw `adk_…` token is shown exactly once;
  only its SHA-256 hash is stored (the same model as a session), so a database
  read never yields a usable credential. A token authenticates as its owner, so
  the owner's role and RBAC apply unchanged. Tokens support an optional expiry
  and can be revoked instantly — independently of the owner's password or
  browser sessions. Admins can revoke anyone's token.

- **Channel-tagged audit attribution.** Every mutation already recorded *who*;
  now it also records *how*. Actions read as `alice` from the web, `alice (api)`
  from a token over REST, or `alice (mcp)` from the MCP agent — so a quiet
  background automation is never an anonymous one.

## Changed

- **MCP is now authenticated and per-user.** The `/mcp/sse` endpoint requires a
  valid personal access token (or an active session); the MCP server is built
  per connection, bound to that user, so its tools (`create_ticket`, `add_note`,
  `log_time`, `send_ticket_email`, …) audit under the real person. Point any SSE
  client at `/mcp/sse` with `Authorization: Bearer <token>` — `.mcp.json` now
  reads the token from `${ANCHORDESK_TOKEN}`.

## Fixed

- **MCP actions are no longer anonymous.** They previously logged under a flat
  `'mcp'` actor regardless of who connected; they are now attributed to the
  authenticated token owner.

## Upgrade notes

- **Schema change:** this release adds the `api_tokens` table. Docker Compose
  applies the Prisma schema on backend startup; for a manual deploy run
  `npx prisma db push` (or `npx prisma migrate deploy`) before starting the
  backend.
- **MCP clients now need a token.** Any existing MCP integration must send a
  personal access token — create one under Account → API tokens and set it as
  `Authorization: Bearer <token>`. (In local dev with `OIDC_DISABLED=true`,
  every request still runs as the dev admin, MCP included.)
- No other configuration changes; otherwise a drop-in upgrade from 1.9.x.

## Validation

- Backend: 63 tests passed; TypeScript build passed.
- Web: 3 tests passed; TypeScript and Vite production build passed.

## Images

- `ghcr.io/spilloid/anchordesk-backend:1.10.0`
- `ghcr.io/spilloid/anchordesk-web-client:1.10.0`
