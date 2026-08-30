/**
 * Personal access token self-service. Mounted under /auth/tokens and reached by
 * the browser through the /api proxy as /api/auth/tokens.
 *
 * Every authenticated user manages their own tokens. Minting a token is gated to
 * interactive (web/session) logins — a token may not be used to farm more tokens,
 * which would let a leaked token silently extend its own lifetime. Listing and
 * revoking are allowed from any channel; admins may revoke anyone's token.
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as apiTokens from '../services/auth/apiTokens';

interface IdParam {
  id: string;
}

export async function apiTokenRoutes(server: FastifyInstance) {
  // List the caller's own tokens (never includes the secret).
  server.get('/auth/tokens', async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await apiTokens.listForUser(req.user.id));
  });

  // Mint a new token. Returns the raw secret exactly once.
  server.post('/auth/tokens', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.authChannel !== 'web') {
      return reply.status(403).send({ error: 'Tokens can only be created from an interactive login' });
    }
    const { name, expiresInDays, scope } = (req.body ?? {}) as {
      name?: string;
      expiresInDays?: number;
      scope?: string;
    };
    if (!name || !name.trim()) return reply.status(400).send({ error: 'name required' });
    if (scope !== undefined && scope !== 'full' && scope !== 'intake') {
      return reply.status(400).send({ error: "scope must be 'full' or 'intake'" });
    }

    const days =
      typeof expiresInDays === 'number' && Number.isFinite(expiresInDays) && expiresInDays > 0
        ? Math.floor(expiresInDays)
        : undefined;

    const { token, secret } = await apiTokens.create(req.user.id, name, req.actorSub, days, scope ?? 'full');
    // `secret` is returned only here — the client must surface it immediately.
    return reply.status(201).send({ token, secret });
  });

  // Revoke a token. Owners revoke their own; admins may revoke any.
  server.delete('/auth/tokens/:id', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Invalid token id' });

    const ok = await apiTokens.revoke(id, {
      id: req.user.id,
      role: req.user.role,
      username: req.user.username,
    });
    if (!ok) return reply.status(404).send({ error: 'Token not found' });
    return reply.send({ ok: true });
  });
}
