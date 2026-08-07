/**
 * Portal v2 MCP parity (registration/approval, access grants). Kept out of the
 * already-large transport module so the REST/MCP workflow remains reviewable
 * as one bounded feature — same rationale as mcpKb.ts/mcpReports.ts.
 */
import type { UserRole } from '@prisma/client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as portalGrants from '../repositories/portalGrantRepository';
import * as portalRegistrations from '../repositories/portalRegistrationRepository';
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

function requireAdmin(role: UserRole) {
  return role === 'admin' ? null : textResult('Requires role: admin', true);
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

  // ─── Registration queue — provisioning CRM/portal access is admin-only ────
  server.tool(
    'list_portal_registrations',
    'List portal self-registration requests, newest first. Filter by pending, approved, or rejected status. Administrator only.',
    { status: z.string().optional() },
    { title: 'List portal registrations', ...readOnlyAnnotations },
    async ({ status }) => {
      const denied = requireAdmin(role);
      if (denied) return denied;
      const normalized = status === undefined
        ? undefined
        : portalRegistrations.validatedRegistrationStatus(status);
      if (status !== undefined && !normalized) {
        return textResult('status must be pending, approved, or rejected', true);
      }
      return jsonResult(await portalRegistrations.list(normalized ?? undefined));
    },
  );

  server.tool(
    'approve_portal_registration',
    'Approve one pending portal registration. This creates or reuses the exact-one Contact, grants portal access, and the REST workflow sends the sign-in email. Administrator only.',
    { registrationId: z.number().int().positive() },
    { title: 'Approve portal registration', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async ({ registrationId }) => {
      const denied = requireAdmin(role);
      if (denied) return denied;
      try {
        const row = await portalRegistrations.approve(registrationId, actor);
        if (!row) return textResult(`Portal registration ${registrationId} not found`, true);
        // MCP is a complete provisioning surface as well. Match REST's
        // non-blocking mail behavior without making SMTP part of the commit.
        void requestMagicLink(row.email).catch(() => {});
        return jsonResult(row);
      } catch (error) {
        if (error instanceof portalRegistrations.PortalRegistrationApprovalError) {
          return textResult(error.message, true);
        }
        throw error;
      }
    },
  );

  server.tool(
    'reject_portal_registration',
    'Reject one pending portal registration without creating a Contact or portal grant. Administrator only.',
    { registrationId: z.number().int().positive() },
    { title: 'Reject portal registration', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async ({ registrationId }) => {
      const denied = requireAdmin(role);
      if (denied) return denied;
      try {
        const row = await portalRegistrations.reject(registrationId, actor);
        if (!row) return textResult(`Portal registration ${registrationId} not found`, true);
        return jsonResult(row);
      } catch (error) {
        if (error instanceof portalRegistrations.PortalRegistrationApprovalError) {
          return textResult(error.message, true);
        }
        throw error;
      }
    },
  );
}
