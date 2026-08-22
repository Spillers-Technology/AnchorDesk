# AnchorDesk 2.4.1 — Checklist MCP Parity (patch)

2.4.1 makes the checklist workflow complete over MCP and makes that contract
testable at the protocol boundary. Agents can work every ticket-checklist
operation exposed by REST, admins can manage reusable templates without
leaving MCP, and the server reports the real AnchorDesk version when a client
connects.

## Complete checklist tool surface

| Workflow | MCP tools / behavior |
|---|---|
| Read a ticket | `get_ticket` continues to include its ordered `checklist` |
| Read checklist data | `list_ticket_checklist`; `list_checklist_templates` with optional inactive templates |
| Build a working list | `apply_checklist_template`; `add_checklist_item` with an optional independent deadline |
| Work the list | `toggle_checklist_item`; `update_checklist_item` for text, completion, deadline, or order; `delete_checklist_item` |
| Administer templates | `create_checklist_template`, `update_checklist_template`, `delete_checklist_template` (admin role required) |

Ticket mutations retain the connection user's normal RBAC and audit actor.
Template creation, replacement, activation, and deletion explicitly require an
admin connection, matching the REST/web boundary. Template application still
copies items onto the ticket: later template edits never rewrite active work.

## ChatGPT: refresh the approved actions

Deploying 2.4.1 changes the live MCP server, but it does not automatically
change a ChatGPT workspace's approved app. OpenAI documents that ChatGPT keeps
a frozen snapshot of an approved MCP app's tools and inputs.

- **Enterprise/Edu:** an admin or owner opens **Workspace Settings → Apps →
  AnchorDesk → Action control**, selects **Refresh**, reviews the diff, enables
  the new checklist actions (new actions are disabled by default), and
  publishes the update.
- **Business:** published apps currently cannot be updated in place. Recreate
  and republish the AnchorDesk app so ChatGPT scans the current tool surface.
- Start a new chat after the app/workspace update and select AnchorDesk from
  the tools menu before testing the checklist workflow.

These steps follow OpenAI's current
[Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta)
guide. Header/PAT clients are not governed by ChatGPT's workspace snapshot;
reconnect them after the backend restart so they run a fresh `tools/list`.

## Contract verification

- MCP initialize now reports the version from `backend/package.json` instead
  of the old hard-coded `1.0.0` server identity.
- An SDK `Client` connected over linked `InMemoryTransport` instances asserts
  the initialize version, advertised tool names and schemas, representative
  checklist calls, template CRUD, and non-admin denial.
- Existing repository tests continue to guard copy-on-apply ordering,
  independent per-item deadlines, done attribution, audit entries, and live
  update publication.

## Upgrade notes

- No schema or data migration; this is a backend MCP surface and documentation
  patch.
- Pull/restart with the normal procedure, then refresh or recreate the ChatGPT
  app as described above.
- The existing 2.4.0 checklist tables and data are unchanged.

## Images

- `ghcr.io/spillers-technology/anchordesk-backend:2.4.1`
- `ghcr.io/spillers-technology/anchordesk-web-client:2.4.1`
