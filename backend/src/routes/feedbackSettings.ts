/**
 * The CSAT switches (the `feedback` settings row). Admin-only in both
 * directions, same shape as `/portal-settings` — see that file's header for
 * why portal-adjacent settings get their own small route rather than folding
 * into the generic `/integrations/:key`.
 */
import { FastifyInstance } from 'fastify';
import { requireRole } from '../middleware/auth';
import * as settings from '../services/settingsService';

export async function feedbackSettingsRoutes(server: FastifyInstance) {
  server.get(
    '/feedback-settings',
    { preHandler: requireRole('admin') },
    async (_req, reply) => reply.send(await settings.getFeedback()),
  );

  server.patch(
    '/feedback-settings',
    { preHandler: requireRole('admin') },
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      for (const field of ['enabled', 'promptOnSolve'] as const) {
        if (field in body && typeof body[field] !== 'boolean') {
          return reply.status(400).send({ error: `${field} must be a boolean` });
        }
      }
      await settings.updateSetting('feedback', body);
      return reply.send(await settings.getFeedback());
    },
  );
}
