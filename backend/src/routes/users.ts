/**
 * Admin user management + auth settings. All routes require the admin role.
 *
 * Local accounts are created/edited here; SSO users appear automatically on
 * first login and can have their role/active state managed. Guard rails prevent
 * locking yourself out (can't remove or demote the last active admin).
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';
import { requireRole } from '../middleware/auth';
import * as userRepo from '../repositories/userRepository';
import { hashPassword } from '../services/auth/password';
import {
  getAuthSettings,
  updateAuthSettings,
  toPublicSettings,
  UpdateAuthSettingsInput,
} from '../services/auth/authConfig';
import { resetOidcCache } from '../services/auth/oidcService';
import { resetSamlCache } from '../services/auth/samlService';

interface IdParam {
  id: string;
}

const ROLES: UserRole[] = ['admin', 'technician', 'readonly'];
const isRole = (r: unknown): r is UserRole => typeof r === 'string' && ROLES.includes(r as UserRole);

export async function userRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };

  // ─── Users ────────────────────────────────────────────────────────────────
  server.get('/users', adminOnly, async (_req, reply) => {
    const users = await userRepo.list();
    return reply.send(users.map(userRepo.toPublic));
  });

  server.post('/users', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      username?: string;
      password?: string;
      displayName?: string;
      email?: string;
      role?: string;
    };
    if (!body.username || !body.password) {
      return reply.status(400).send({ error: 'username and password are required' });
    }
    if (body.role && !isRole(body.role)) return reply.status(400).send({ error: 'invalid role' });

    const existing = await userRepo.findLocalByUsername(body.username);
    if (existing) return reply.status(409).send({ error: 'username already exists' });

    try {
      const passwordHash = await hashPassword(body.password);
      const user = await userRepo.createLocal(
        {
          username: body.username,
          passwordHash,
          displayName: body.displayName,
          email: body.email,
          role: isRole(body.role) ? body.role : 'technician',
        },
        req.actorSub
      );
      return reply.status(201).send(userRepo.toPublic(user));
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  server.patch<{ Params: IdParam }>('/users/:id', adminOnly, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const body = (req.body ?? {}) as {
      displayName?: string;
      email?: string;
      role?: string;
      isActive?: boolean;
    };
    if (body.role !== undefined && !isRole(body.role)) return reply.status(400).send({ error: 'invalid role' });

    const target = await userRepo.findById(id);
    if (!target) return reply.status(404).send({ error: 'user not found' });

    // Don't let the last active admin be demoted or deactivated.
    const losingAdmin =
      target.role === 'admin' &&
      target.isActive &&
      ((body.role !== undefined && body.role !== 'admin') || body.isActive === false);
    if (losingAdmin && (await userRepo.countActiveAdmins()) <= 1) {
      return reply.status(400).send({ error: 'Cannot demote or deactivate the last active admin' });
    }

    const user = await userRepo.update(
      id,
      {
        displayName: body.displayName,
        email: body.email,
        role: isRole(body.role) ? body.role : undefined,
        isActive: body.isActive,
      },
      req.actorSub
    );
    return reply.send(userRepo.toPublic(user));
  });

  // Admin password reset for a local account.
  server.post<{ Params: IdParam }>(
    '/users/:id/password',
    adminOnly,
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      const { password } = (req.body ?? {}) as { password?: string };
      if (!password) return reply.status(400).send({ error: 'password required' });

      const target = await userRepo.findById(id);
      if (!target) return reply.status(404).send({ error: 'user not found' });
      if (target.authProvider !== 'local') {
        return reply.status(400).send({ error: 'Only local accounts have passwords' });
      }
      try {
        const hash = await hashPassword(password);
        await userRepo.setPassword(id, hash, req.actorSub);
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
      return reply.send({ ok: true });
    }
  );

  server.delete<{ Params: IdParam }>('/users/:id', adminOnly, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (id === req.user.id) return reply.status(400).send({ error: 'You cannot delete your own account' });

    const target = await userRepo.findById(id);
    if (!target) return reply.status(404).send({ error: 'user not found' });
    if (target.role === 'admin' && target.isActive && (await userRepo.countActiveAdmins()) <= 1) {
      return reply.status(400).send({ error: 'Cannot delete the last active admin' });
    }

    await userRepo.remove(id, req.actorSub);
    return reply.status(204).send();
  });

  // ─── Auth settings ──────────────────────────────────────────────────────────
  server.get('/auth/settings', adminOnly, async (_req, reply) => {
    const settings = await getAuthSettings();
    return reply.send(toPublicSettings(settings));
  });

  server.patch('/auth/settings', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as UpdateAuthSettingsInput;
    const updated = await updateAuthSettings(body);
    // IdP config may have changed — drop cached discovery/clients.
    resetOidcCache();
    resetSamlCache();
    return reply.send(toPublicSettings(updated));
  });
}
