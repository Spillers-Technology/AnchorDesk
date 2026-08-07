/**
 * The customer-portal switch (the `portal` settings row).
 *
 * Admin-only in both directions, unlike `/ui-settings`. Interface preferences
 * are read by every user because the client needs them to render the right
 * nav; whether a shop runs a customer portal is an operational fact ordinary
 * staff have no reason to query, and the surfaces it controls already fail
 * closed on their own.
 *
 * Enforcement does not live here — `middleware/kbPortalAccess`, the portal
 * route plugins, and the requester-session check each consult
 * `isPortalEnabled()` directly. This route only lets an admin read and set it.
 */
import { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/auth';
import * as settings from '../services/settingsService';

export async function portalSettingsRoutes(server: FastifyInstance) {
  server.get(
    '/portal-settings',
    { preHandler: requireRole('admin') },
    async (_req, reply) => reply.send(await settings.getPortal()),
  );

  server.patch(
    '/portal-settings',
    { preHandler: requireRole('admin') },
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Only ever accept a real boolean. A stray string would be truthy and
      // switch a customer-facing surface on by accident.
      for (const field of ['enabled', 'allowAttachments', 'allowSelfSolve'] as const) {
        if (field in body && typeof body[field] !== 'boolean') {
          return reply.status(400).send({ error: `${field} must be a boolean` });
        }
      }
      if ('ticketScope' in body && body.ticketScope !== 'own' && body.ticketScope !== 'company') {
        return reply.status(400).send({ error: 'ticketScope must be own or company' });
      }
      if (
        'technicianIdentity' in body &&
        body.technicianIdentity !== 'anonymous' &&
        body.technicianIdentity !== 'named'
      ) {
        return reply.status(400).send({ error: 'technicianIdentity must be anonymous or named' });
      }
      await settings.updateSetting('portal', body);
      return reply.send(await settings.getPortal());
    },
  );
}
