# MCP Authentication

AnchorDesk exposes its Model Context Protocol server at `/mcp/sse`. The MCP
server can create and update tickets, add notes, log time, send ticket email,
work complete ticket checklists and reusable templates, use
labels/teams/custom fields/views, search, and read ticket history, so `/mcp/*`
is never public in a real deployment.

There are two supported authentication paths.

## Tool coverage

Every tool runs as the user who owns the personal token or approved the OAuth
connection. The same REST validation, RBAC, and audit actor are used by the web
client and MCP server.

| Area | Tools / behavior |
|---|---|
| Ticket read | `list_tickets`, `get_ticket`, and typo-tolerant `search_tickets`; list filters include status, assignee, company, label, team, text, and closed visibility |
| Ticket write | `create_ticket` and `update_ticket`, including queue `teamId` and validated `customFields` |
| Conversation | `add_note`, `log_time`, and threaded `send_ticket_email` |
| Audit | `get_ticket_history` returns the actor-attributed ticket revision stream |
| Labels | `list_labels` and `set_ticket_label` (apply or remove) |
| Configuration | `list_teams` and `list_custom_fields` expose the ids/keys agents need for ticket writes |
| Views | `list_saved_views` returns the current user's personal views plus admin-published shared filter sets; pass a view's filters to `list_tickets` |
| Checklists | Full item and template coverage is listed below; `get_ticket` also embeds the ordered working checklist |

Administration of teams, field definitions, automation rules, and shared views
remains in the authenticated REST/web admin surfaces. MCP consumes those
definitions but does not bypass their ownership or admin boundaries. Checklist
templates are the exception: their full admin CRUD is available through
explicitly admin-gated MCP tools.

### Checklist tool matrix

Every ticket-checklist operation available through REST has an MCP counterpart.
Item deadlines remain independent from the ticket's manual/SLA clocks, and
applying a template copies its items so later template edits never rewrite
ticket work.

| Tool | Purpose | Role |
|---|---|---|
| `list_checklist_templates` | List active templates; pass `includeInactive: true` to include disabled templates | authenticated |
| `list_ticket_checklist` | Return one ticket's ordered working checklist | authenticated |
| `apply_checklist_template` | Copy a template's items onto a ticket and calculate relative deadlines | technician/admin |
| `add_checklist_item` | Add an ad-hoc item with optional ISO 8601 `dueAt` | technician/admin |
| `toggle_checklist_item` | Mark an item done/undone with who/when attribution | technician/admin |
| `update_checklist_item` | Change an item's `text`, `done`, `dueAt`, or `sortOrder` | technician/admin |
| `delete_checklist_item` | Remove an item from a ticket | technician/admin |
| `create_checklist_template` | Create a reusable template and its ordered items | admin |
| `update_checklist_template` | Change name, description, active state, or replace the ordered items | admin |
| `delete_checklist_template` | Delete a template without touching items already copied to tickets | admin |

`get_ticket` also includes the working checklist alongside the ticket and its
notes. All mutations keep the approving/token owner's audit identity with the
`(mcp)` channel marker.

## Option 1: Personal Access Token

Use this path for MCP clients that can send custom HTTP headers.

1. Sign in to AnchorDesk.
2. Open the account menu and create an API token.
3. Copy the token once. AnchorDesk stores only its SHA-256 hash, so it cannot
   show the same raw token again later.
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

This is the simplest path for local tools, service agents, and clients that
support request headers.

## Option 2: Built-In OAuth

Use this path for OAuth-capable MCP clients such as ChatGPT custom connectors.

AnchorDesk is its own OAuth 2.0 authorization server for MCP. No external IdP
or OIDC application is required for this flow.

The flow is:

1. The client points at `https://your-anchordesk.example.com/mcp/sse`.
2. The client discovers resource metadata from:

```text
https://your-anchordesk.example.com/.well-known/oauth-protected-resource
```

3. The client discovers authorization-server metadata from:

```text
https://your-anchordesk.example.com/.well-known/oauth-authorization-server
```

4. The client dynamically registers at `/oauth/register`.
5. The user is sent to `/oauth/authorize`.
6. If the user is not signed in, AnchorDesk redirects to the normal app login
   and returns to consent afterward.
7. Approving consent issues a short-lived authorization code bound to PKCE.
8. The client redeems the code at `/oauth/token`.
9. AnchorDesk returns an access token that is a freshly minted personal access
   token for the approving user.

The resulting MCP actions run as that user. RBAC and audit attribution are the
same as web/API-token activity, and the grant can be revoked from **Account ->
API tokens**.

## ChatGPT Setup

1. In ChatGPT, create a custom connector.
2. Set the server URL to:

```text
https://your-anchordesk.example.com/mcp/sse
```

3. Choose OAuth authentication.
4. Let ChatGPT discover/register automatically.
5. Complete the AnchorDesk login and consent prompt.

You do not need to create an OAuth client in Azure AD, Authentik, Okta, or any
other external IdP for MCP. OIDC and SAML are still available for normal browser
SSO, but MCP OAuth is handled by AnchorDesk itself.

### Refresh actions after an AnchorDesk upgrade

ChatGPT does not automatically adopt later changes to an approved MCP app.
OpenAI describes the approved tools and inputs as a **frozen snapshot**. After
an AnchorDesk release adds or changes tools:

- **Enterprise/Edu:** an admin or owner opens **Workspace Settings → Apps →
  AnchorDesk → Action control**, selects **Refresh**, reviews the action diff,
  enables the desired new actions, and publishes the update. New actions are
  disabled by default.
- **Business:** published apps currently cannot be updated in place. Recreate
  and republish the AnchorDesk app to scan the current tools and metadata.
- Open a new chat, select AnchorDesk from the tools menu, and test a read plus
  a write action after the workspace update.

The UI and availability are still in beta; use OpenAI's current
[Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta)
article as the source of truth. A normal PAT/header MCP client does not use the
ChatGPT workspace snapshot: reconnect that client after upgrading so it issues
a fresh `tools/list` request.

## Deployment Checks

Set `APP_BASE_URL` to the public origin clients will use:

```dotenv
APP_BASE_URL=https://tickets.example.com
```

After deployment, these URLs should return JSON, not the AnchorDesk web app
HTML:

```text
https://tickets.example.com/.well-known/oauth-protected-resource
https://tickets.example.com/.well-known/oauth-authorization-server
```

The bundled nginx config and Vite dev proxy forward `/.well-known/*` and
`/oauth/*` to the backend. If you use a custom reverse proxy, make sure these
routes are above any single-page-app fallback.

## Troubleshooting

### Metadata URL shows the app shell

Your web proxy is routing `/.well-known/*` to the frontend fallback instead of
the backend. Move the well-known proxy rule above the SPA catchall.

### ChatGPT cannot register

Check that `POST /oauth/register` reaches the backend and that `APP_BASE_URL`
matches the public origin. Registered redirect URIs must be exact and must use
HTTPS, except for localhost development.

### The consent page redirects to login repeatedly

The user does not have a valid AnchorDesk session after login. Check cookie
domain, `APP_BASE_URL`, reverse-proxy `X-Forwarded-*` headers, and session
secret configuration.

### Token exchange fails

Authorization codes are single-use, short-lived, and PKCE-bound. A replayed
code, mismatched `code_verifier`, unknown client, or changed redirect URI is
rejected intentionally.

### MCP calls get 401 after OAuth succeeds

The access token is validated through AnchorDesk's bearer-token path. Confirm
the generated API token has not expired or been revoked, and confirm the user is
active.

### ChatGPT connects but new checklist tools are missing

The workspace is still using its frozen approved-action snapshot. Refresh and
enable the actions on Enterprise/Edu, or recreate and republish the app on
Business, using the steps under [ChatGPT Setup](#refresh-actions-after-an-anchordesk-upgrade).
Starting a new chat alone does not update the workspace snapshot.

### The connector has the wrong permissions

MCP actions use the approving user's AnchorDesk role. A `readonly` user can read
through MCP but cannot mutate tickets or send email. Use a technician or admin
account when the connector needs write access.
