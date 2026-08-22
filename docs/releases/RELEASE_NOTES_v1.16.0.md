# AnchorDesk 1.16.0 — Trust Anchor (minor)

AnchorDesk is now its own OAuth 2.0 authorization server for MCP. ChatGPT's custom
connector — and any OAuth-capable MCP client — completes the full
authorization-code + PKCE handshake directly against AnchorDesk, with a one-click
consent screen backed by your existing login. No external identity provider is
involved in the MCP OAuth flow.

This supersedes the 1.15.0 approach, which advertised the configured OIDC issuer as
the authorization server. In practice ChatGPT's connector requires **Dynamic Client
Registration** (it has no pre-shared client ID and no field to paste one), and few
external IdPs allow open registration — so the delegated flow stalled before it
could start. Self-hosting the authorization server removes that dependency
entirely.

## Added

- **Built-in OAuth authorization server (`services/auth/oauthProvider.ts`,
  `routes/oauth.ts`).**
  - `POST /oauth/register` — Dynamic Client Registration (RFC 7591). Public clients
    only (PKCE, no secret); redirect URIs must be `https` (or `http` on localhost).
  - `GET /oauth/authorize` — a branded consent screen gated on an active AnchorDesk
    session. An unauthenticated visitor is bounced to the SPA login carrying the
    request (`?oauth_return=…`, restricted to same-origin `/oauth/` paths) and
    returned to consent after signing in. Approval issues a single-use,
    PKCE-S256-bound, short-lived authorization code.
  - `POST /oauth/token` — redeems the code for an access token. **The token is a
    freshly minted personal access token** for the approving user, so the existing
    bearer path validates it offline, RBAC and audit attribution are unchanged, and
    the grant is revocable from **Account → API tokens**.
  - `GET /.well-known/oauth-authorization-server` — RFC 8414 metadata pointing at
    the endpoints above.

## Changed

- `/.well-known/oauth-protected-resource` now advertises `APP_BASE_URL` (AnchorDesk
  itself) as the authorization server instead of the OIDC issuer.
- nginx and the Vite dev proxy forward `/oauth/*` and
  `/.well-known/oauth-authorization-server` to the backend.
- Backend and web-client package versions are now `1.16.0`.

## Upgrade notes

- **Schema change:** two additive tables (`oauth_clients`, `oauth_auth_codes`). Run
  `prisma db push` (or `make db-push` against the backend pod) on upgrade.
- **Connecting ChatGPT:** point the custom connector at
  `https://<your-app-base-url>/mcp/sse`. Discovery, registration, and the consent
  screen are automatic. OIDC no longer needs to be enabled for MCP OAuth; the
  authorization server is AnchorDesk. The flow requires a real login, so it is
  exercised only when auth is enabled (with `OIDC_DISABLED=true` in local dev every
  request is already the dev admin and the OAuth layer is bypassed).
- Header-capable MCP clients can still send an `adk_…` personal access token as a
  bearer directly — unchanged.

## Validation

- Backend and web-client TypeScript builds pass.
- Backend test suite: **94 tests pass** (12 new, covering the authorization-server
  metadata, public-path exemptions, consent CSRF, and error redirects).
- End-to-end flow exercised against a live server: discovery → dynamic registration
  → consent → approval → code → token → the minted token authenticates on a
  protected route. Security guards verified: code single-use/replay rejection, PKCE
  mismatch rejection, unregistered-redirect-URI rejection, unknown-client rejection,
  and plaintext-http registration rejection.

## Images

- `ghcr.io/spillers-technology/anchordesk-backend:1.16.0`
- `ghcr.io/spillers-technology/anchordesk-web-client:1.16.0`
