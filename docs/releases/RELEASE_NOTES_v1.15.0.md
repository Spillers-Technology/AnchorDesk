# AnchorDesk 1.15.0 — Connected Domains (minor)

AnchorDesk hosted on a custom domain can now connect its ticketing MCP tools to
OAuth clients such as ChatGPT. The MCP server advertises protected-resource
metadata, trusts the configured OIDC provider, and keeps personal access tokens
available for header-capable clients.

## Added

- **OAuth-ready MCP for hosted instances.** `/.well-known/oauth-protected-resource`
  now advertises the AnchorDesk MCP resource and configured OIDC issuer, allowing
  OAuth clients to discover how to authenticate before calling `/mcp/sse`.
- **MCP auth challenges.** Unauthenticated `/mcp/*` requests include a
  `WWW-Authenticate` hint pointing clients at the protected-resource metadata.
- **ChatGPT setup guide.** New MCP auth documentation covers the easier IdP path,
  callback URL setup, OAuth client fields, scopes, and troubleshooting.

## Changed

- The production web proxy now forwards `/.well-known/oauth-protected-resource`
  to the backend so hosted custom-domain installs return JSON discovery instead
  of the web app shell.
- Backend and web-client package versions are now `1.15.0`.

## Upgrade notes

- No schema change.
- For ChatGPT, OIDC must be enabled in AnchorDesk. Add ChatGPT's callback URL to
  an OIDC app in your identity provider, then use that IdP-issued client ID and
  secret in ChatGPT. Do not use an AnchorDesk `adk_...` API token as an OAuth
  client secret.

## Validation

- Backend and web-client TypeScript builds pass.
- Backend test suite: **86 tests pass**.
- GitHub PR checks pass.

## Images

- `ghcr.io/spillers-technology/anchordesk-backend:1.15.0`
- `ghcr.io/spillers-technology/anchordesk-web-client:1.15.0`
