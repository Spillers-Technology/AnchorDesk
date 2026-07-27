import {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { createHash } from 'crypto';
import { requesterPrincipalFor } from '../types/principal';
import type { RequesterPrincipal } from '../types/principal';
import {
  redeemMagicLink,
  requestMagicLink,
} from '../services/auth/portalMagicLinks';
import {
  clearSessionCookie,
  hashSessionToken,
  PORTAL_SESSION_TTL_MS,
  SESSION_COOKIE,
  setSessionCookie,
} from '../services/auth/sessions';
import { revokePortalSession } from '../repositories/portalAuthRepository';
import { actorFor } from '../middleware/auth';
import { isPortalEnabled } from '../services/settingsService';

export const MAGIC_LINK_GENERIC_RESPONSE = {
  ok: true,
  message:
    'If that email address is registered, a sign-in link will arrive shortly.',
} as const;

export interface PublicRequesterIdentity {
  displayName: string;
  email: string;
}

/** Explicit portal identity allowlist; contact/company ids stay server-side. */
export function toPublicRequesterIdentity(
  requester: RequesterPrincipal,
): PublicRequesterIdentity {
  return {
    displayName: requester.name,
    email: requester.email,
  };
}

function bodyKey(
  prefix: string,
  value: unknown,
  caseInsensitive = false,
): string {
  const text =
    typeof value === 'string' && value.trim()
      ? value.trim()
      : 'invalid';
  const normalized = caseInsensitive ? text.toLowerCase() : text;
  return `${prefix}:${createHash('sha256').update(normalized).digest('hex')}`;
}

const requestLinkThrottle = {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: '15 minutes',
      hook: 'preHandler' as const,
      // Per-recipient throttling works behind nginx without trusting a
      // forgeable forwarding header or collapsing every customer onto the
      // proxy's socket IP. The key contains no address text.
      keyGenerator: (req: FastifyRequest) =>
        bodyKey(
          'portal-magic-link',
          (req.body as { email?: unknown } | null)?.email,
          true,
        ),
    },
  },
};
const verifyThrottle = {
  config: {
    rateLimit: {
      max: 20,
      timeWindow: '1 minute',
      hook: 'preHandler' as const,
      keyGenerator: (req: FastifyRequest) =>
        bodyKey(
          'portal-magic-verify',
          (req.body as { token?: unknown } | null)?.token,
        ),
    },
  },
};

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

export async function portalAuthRoutes(server: FastifyInstance) {
  // Release gate: while the customer portal is switched off (the default) these
  // routes do not exist. 404 rather than 403 on purpose — an anonymous prober
  // should not learn that a shop has a portal at all, and the magic-link
  // endpoint is deliberately non-disclosing everywhere else too.
  server.addHook('onRequest', async (_request, reply) => {
    if (!(await isPortalEnabled())) {
      return reply.status(404).send({ error: 'Not found' });
    }
  });


  /**
   * Return before contact lookup or SMTP. Besides keeping the response generic,
   * this keeps known/unknown/ambiguous addresses off observably different DB and
   * network latency paths. Background failures are logged without the token,
   * address, or provider error (SMTP errors can echo recipients).
   */
  server.post(
    '/portal/auth/magic-link',
    requestLinkThrottle,
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireJson(req, reply)) return;
      const email = (req.body as { email?: unknown } | null)?.email;
      setImmediate(() => {
        void requestMagicLink(email).catch(() => {
          server.log.warn('Portal magic-link dispatch failed');
        });
      });
      noStore(reply);
      return reply.status(202).send(MAGIC_LINK_GENERIC_RESPONSE);
    },
  );

  server.post(
    '/portal/auth/verify',
    verifyThrottle,
    async (req: FastifyRequest, reply: FastifyReply) => {
      // A cross-origin HTML form can submit urlencoded data and replace the
      // shared session cookie with the attacker's requester account. Requiring
      // JSON forces a browser preflight; AnchorDesk exposes no permissive CORS.
      if (!requireJson(req, reply)) return;
      const token = (req.body as { token?: unknown } | null)?.token;
      const redeemed = await redeemMagicLink(token, {
        userAgent: String(req.headers['user-agent'] ?? ''),
        ip: req.ip,
      });
      noStore(reply);
      if (!redeemed) {
        return reply
          .status(401)
          .send({ error: 'Invalid or expired sign-in link' });
      }

      setSessionCookie(
        reply,
        redeemed.sessionToken,
        PORTAL_SESSION_TTL_MS,
      );
      return reply.send({
        requester: toPublicRequesterIdentity(redeemed.requester),
      });
    },
  );

  server.get(
    '/portal/auth/me',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const requester = requesterPrincipalFor(req);
      noStore(reply);
      if (!requester) {
        return reply.status(403).send({ error: 'Requester session required' });
      }
      return reply.send({
        requester: toPublicRequesterIdentity(requester),
      });
    },
  );

  server.post(
    '/portal/auth/logout',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const requester = requesterPrincipalFor(req);
      if (!requester) {
        return reply.status(403).send({ error: 'Requester session required' });
      }
      const token = req.cookies?.[SESSION_COOKIE];
      if (token) {
        await revokePortalSession({
          contactId: requester.contactId,
          tokenHash: hashSessionToken(token),
          actor: actorFor(`requester:${requester.contactId}`, 'portal'),
        });
      }
      clearSessionCookie(reply);
      noStore(reply);
      return reply.send({ ok: true });
    },
  );
}
