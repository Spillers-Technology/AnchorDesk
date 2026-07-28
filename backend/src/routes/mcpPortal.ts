/**
 * Portal v2 MCP parity (registration/approval, access grants). Kept out of the
 * already-large transport module so the REST/MCP workflow remains reviewable
 * as one bounded feature — same rationale as mcpKb.ts/mcpReports.ts.
 */
import type { UserRole } from '@prisma/client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as portalGrants from '../repositories/portalGrantRepository';
import * as companies from '../repositories/companyRepository';
import { requestMagicLink } from '../services/auth/portalMagicLinks';

function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(isError ? { isError: true as const } : {}),
  };
}

function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value, null, 2));
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerPortalTools(
  server: McpServer,
  actor: string,
  role: UserRole,
): void {
  // ─── Access grants — write-role, same RBAC as POST /contacts/:id/portal-grant ─
  server.tool(
    'grant_portal_access',
    'Grant a contact portal access as a new record (never edits a prior grant). Auto-sends the sign-in email if the contact has an address on file.',
    {
      contactId: z.number().int(),
      effectiveFrom: z.string().datetime().optional()
        .describe('ISO 8601 instant; defaults to now. Set to a past date to also expose ticket history when combined with company-wide scope.'),
    },
    { title: 'Grant portal access', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ contactId, effectiveFrom }) => {
      const contact = await companies.getContactById(contactId);
      if (!contact) return textResult(`No contact with id ${contactId}`, true);
      const row = await portalGrants.grant(
        { contactId: contact.id, companyId: contact.companyId, effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined },
        actor,
      );
      if (contact.email) {
        void requestMagicLink(contact.email).catch(() => {});
      }
      return jsonResult(row);
    },
  );

  server.tool(
    'revoke_portal_access',
    "Revoke a contact's active portal grant. A no-op (error result) if none is active.",
    { contactId: z.number().int() },
    { title: 'Revoke portal access', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async ({ contactId }) => {
      const row = await portalGrants.revoke(contactId, actor);
      if (!row) return textResult(`No active portal grant for contact ${contactId}`, true);
      return jsonResult(row);
    },
  );

  server.tool(
    'list_portal_grants',
    'List every portal-access grant ever issued to a contact, newest first (the full history, not just the current state).',
    { contactId: z.number().int() },
    { title: 'List portal grants', ...readOnlyAnnotations },
    async ({ contactId }) => jsonResult(await portalGrants.listForContact(contactId)),
  );

  // Registration-queue tools (list/approve/reject) are appended here in
  // Phase 4 once portalRegistrationRepository exists.
}
