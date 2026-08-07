import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireRole } from '../middleware/auth';
import * as registrations from '../repositories/portalRegistrationRepository';
import { findCompanyForEmailDomain } from '../services/companyResolution';
import { normalizePortalEmail, requestMagicLink } from '../services/auth/portalMagicLinks';
import { isPortalEnabled } from '../services/settingsService';
import { parseId } from '../util/ids';
import { bodyKey } from './portalAuth';

export const PORTAL_REGISTRATION_GENERIC_RESPONSE = {
  ok: true,
  message: 'Check your email for an update on your portal access request.',
} as const;

function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

function requireJson(request: FastifyRequest, reply: FastifyReply): boolean {
  const mediaType = String(request.headers['content-type'] ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType === 'application/json') return true;
  reply.status(415).send({ error: 'Content-Type must be application/json' });
  return false;
}

export async function portalRegistrationRoutes(server: FastifyInstance) {
  // Same release gate as the portal auth and requester plugins. Before an admin
  // intentionally enables the portal, this public-looking path is absent.
  server.addHook('onRequest', async (_request, reply) => {
    if (!(await isPortalEnabled())) {
      return reply.status(404).send({ error: 'Not found' });
    }
  });

  const perEmailThrottle = server.rateLimit({
    max: 5,
    timeWindow: '15 minutes',
    keyGenerator: (request) => {
      return bodyKey(
        'portal-registration-email',
        (request.body as { email?: unknown } | null)?.email,
        true,
      );
    },
  });
  const perIpThrottle = server.rateLimit({
    max: 20,
    timeWindow: '15 minutes',
    keyGenerator: (request) => bodyKey('portal-registration-ip', request.ip),
  });

  server.post(
    '/portal/register',
    { preHandler: [perEmailThrottle, perIpThrottle] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireJson(req, reply)) return;
      const email = normalizePortalEmail(
        (req.body as { email?: unknown } | null)?.email,
      );
      // Respond before matching or persistence so neither a known domain nor a
      // database failure changes the visible response or its timing profile.
      if (email) {
        setImmediate(() => {
          void findCompanyForEmailDomain(email)
            .then((company) => registrations.create(
              { email, companyId: company?.id ?? null },
              'anonymous (portal-registration)',
            ))
            .catch(() => {
              req.log.warn('Portal registration persistence failed');
            });
        });
      }
      noStore(reply);
      return reply.status(202).send(PORTAL_REGISTRATION_GENERIC_RESPONSE);
    },
  );

  server.get(
    '/portal-registrations',
    { preHandler: requireRole('admin') },
    async (req, reply) => {
      const value = (req.query as { status?: unknown } | null)?.status;
      const status = value === undefined ? undefined : registrations.validatedRegistrationStatus(value);
      if (value !== undefined && !status) {
        return reply.status(400).send({ error: 'status must be pending, approved, or rejected' });
      }
      return reply.send(await registrations.list(status ?? undefined));
    },
  );

  server.post<{ Params: { id: string } }>(
    '/portal-registrations/:id/approve',
    { preHandler: requireRole('admin') },
    async (req, reply) => {
      const id = parseId(req.params.id);
      if (id === null) return reply.status(400).send({ error: 'invalid registration id' });
      try {
        const row = await registrations.approve(id, req.actorSub);
        if (!row) return reply.status(404).send({ error: 'registration not found' });
        // Deliberately after the transaction: a slow/failing SMTP provider
        // cannot turn an approved, audited access record into a rollback.
        setImmediate(() => {
          void requestMagicLink(row.email).catch(() => {
            req.log.warn('Portal registration approval magic-link dispatch failed');
          });
        });
        return reply.send(row);
      } catch (error) {
        if (error instanceof registrations.PortalRegistrationApprovalError) {
          return reply.status(409).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  server.post<{ Params: { id: string } }>(
    '/portal-registrations/:id/reject',
    { preHandler: requireRole('admin') },
    async (req, reply) => {
      const id = parseId(req.params.id);
      if (id === null) return reply.status(400).send({ error: 'invalid registration id' });
      try {
        const row = await registrations.reject(id, req.actorSub);
        if (!row) return reply.status(404).send({ error: 'registration not found' });
        return reply.send(row);
      } catch (error) {
        if (error instanceof registrations.PortalRegistrationApprovalError) {
          return reply.status(409).send({ error: error.message });
        }
        throw error;
      }
    },
  );
}
