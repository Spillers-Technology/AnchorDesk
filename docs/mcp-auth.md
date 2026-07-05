# MCP Authentication

AnchorDesk exposes its Model Context Protocol server at `/mcp/sse`. The MCP
server is powerful: it can create and update tickets, add notes, log time, send
ticket email, and read ticket history. For that reason, `/mcp/*` is never public
in a real deployment.

There are two supported ways to authenticate an MCP client.

## Option 1: Personal Access Token

Use this path for MCP clients that can send custom HTTP headers.

1. Sign in to AnchorDesk.
2. Open the account menu and create an API token.
3. Copy the token once. AnchorDesk stores only its hash, so it cannot show the
   same raw token again later.
4. Configure your MCP client with:

```json
{
  "type": "sse",
  "url": "https://your-anchordesk.example.com/mcp/sse",
  "headers": {
    "Authorization": "Bearer adk_..."
  }
}
```

This is the simplest path for local tools, service agents, and clients like
Codex or Claude Desktop that support request headers.

## Option 2: OAuth/OIDC

Use this path for clients like ChatGPT that do OAuth sign-in instead of custom
bearer headers.

AnchorDesk does not mint OAuth tokens itself. It acts as an OAuth protected
resource and trusts your existing OIDC identity provider. In plain English:

- ChatGPT signs the user in with your OIDC provider.
- The provider gives ChatGPT an access token.
- ChatGPT calls AnchorDesk MCP with that bearer token.
- AnchorDesk resolves the token through the same OIDC configuration used for SSO.

SAML-only SSO is not enough for this flow. Your identity provider must expose an
OIDC/OAuth application.

### Before You Start

Make sure AnchorDesk has OIDC enabled in **Admin -> Authentication**.

The public `APP_BASE_URL` must match the URL ChatGPT will use, for example:

```dotenv
APP_BASE_URL=https://tickets.example.com
```

After deployment, this URL should return JSON:

```text
https://tickets.example.com/.well-known/oauth-protected-resource
```

It should not return the AnchorDesk web app HTML.

## ChatGPT Setup

1. In ChatGPT, create a new app or connector.
2. Set the server URL to:

```text
https://tickets.example.com/mcp/sse
```

3. Choose OAuth authentication. AnchorDesk's MCP server expects every MCP call to
   be authenticated, so OAuth is the normal choice.
4. Open **Advanced OAuth settings**.
5. Choose **User-Defined OAuth Client**.
6. Copy the callback URL shown by ChatGPT.
7. In your OIDC provider, create a new OAuth/OIDC application, or reuse the
   existing AnchorDesk OIDC application if your provider allows multiple redirect
   URIs.
8. Add the ChatGPT callback URL as an allowed redirect URI.
9. In ChatGPT, paste the OAuth client ID and, if your provider issued one, the
   OAuth client secret.
10. Use scopes:

```text
openid profile email
```

11. Set the token endpoint auth method to match the identity provider. Common
    values are `client_secret_post`, `client_secret_basic`, or `none` for a
    public PKCE client.
12. Create the connector and complete the sign-in prompt.

Do not paste an AnchorDesk `adk_...` personal access token into the OAuth client
secret field. That field is for a client secret issued by the OIDC provider.

## The Easiest IdP Path

For a less technical setup, reuse the same OIDC application already configured
for AnchorDesk browser SSO, then add the ChatGPT callback URL to that app's
allowed redirect URIs.

This is easier because AnchorDesk already knows that issuer and client
configuration. If your IdP does not allow multiple redirect URIs, create a
separate OIDC application for ChatGPT with the same issuer and the same userinfo
claims (`sub`, `email`, `preferred_username`, and `name`).

## What the Orange Warnings Mean

ChatGPT may show warnings such as:

- **DCR is unavailable until a Registration URL is present.**
- **CIMD is unavailable because the server did not advertise CIMD support.**

Those warnings are not the problem when you choose **User-Defined OAuth Client**.
They only mean AnchorDesk is not doing dynamic OAuth client registration for you.
You provide the OAuth client ID and secret manually from your IdP instead.

## Troubleshooting

### The metadata URL shows the AnchorDesk app, not JSON

The web proxy is not forwarding `/.well-known/oauth-protected-resource` to the
backend. In the bundled nginx config, this route must be above the SPA fallback.

### ChatGPT says OAuth setup is incomplete

Check these fields:

- **OAuth Client ID:** the client ID from your OIDC provider.
- **OAuth Client Secret:** the secret from your OIDC provider, not an AnchorDesk
  API token.
- **Callback URL:** must be added exactly to the IdP application.
- **Scopes:** start with `openid profile email`.
- **Token endpoint auth method:** must match the IdP application's setting.

### ChatGPT signs in but MCP calls still get 401

AnchorDesk could not resolve the bearer token. Check that:

- OIDC is enabled in AnchorDesk.
- The issuer URL in AnchorDesk matches the provider that issued the token.
- The token allows access to the provider's userinfo endpoint, or the provider
  supports introspection for this client.
- The user exists and is active in AnchorDesk after SSO upsert.

### The account has the wrong permissions

MCP actions use the signed-in user's AnchorDesk role. A `readonly` user can read
through MCP but cannot mutate tickets or send email. Give the user a technician
or admin role if the connector needs write access.
