/**
 * Admin console backend: an Overview snapshot (counts + health) and a
 * cross-entity audit-log viewer. Admin-only.
 *
 * BigInt ids from the audit log are stringified so they serialize as JSON.
 */
import { FastifyInstance } from 'fastify';
import { AuditAction } from '@prisma/client';
import { requireRole } from '../middleware/auth';
import { prisma } from '../db/prisma';
import * as audit from '../repositories/auditRepository';

export async function adminRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };

  // Dashboard snapshot.
  server.get('/admin/overview', adminOnly, async (_req, reply) => {
    const [
      ticketsOpen,
      ticketsTotal,
      devicesTotal,
      devicesOnline,
      probesTotal,
      probesOnline,
      users,
      mailboxes,
      recentAudit,
    ] = await Promise.all([
      prisma.ticket.count({ where: { status: { notIn: ['Closed', 'Deleted'] } } }),
      prisma.ticket.count({ where: { status: { not: 'Deleted' } } }),
      prisma.device.count(),
      prisma.device.count({ where: { status: 'online' } }),
      prisma.probe.count(),
      prisma.probe.count({ where: { status: 'online' } }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.mailbox.count({ where: { enabled: true } }),
      audit.recent({ limit: 8 }),
    ]);

    return reply.send({
      tickets: { open: ticketsOpen, total: ticketsTotal },
      devices: { total: devicesTotal, online: devicesOnline },
      probes: { total: probesTotal, online: probesOnline },
      users,
      mailboxes,
      recentAudit: recentAudit.map((a) => ({ ...a, id: a.id.toString() })),
    });
  });

  // Audit-log viewer.
  server.get('/admin/audit', adminOnly, async (req, reply) => {
    const q = req.query as Record<string, string>;
    const events = await audit.recent({
      entityType: q.entityType || undefined,
      action: (q.action as AuditAction) || undefined,
      limit: q.limit ? parseInt(q.limit, 10) : 100,
    });
    return reply.send(events.map((a) => ({ ...a, id: a.id.toString() })));
  });
}
