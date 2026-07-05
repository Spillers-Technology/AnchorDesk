import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DeviceSource } from '@prisma/client';
import * as deviceRepo from '../repositories/deviceRepository';
import * as audit from '../repositories/auditRepository';
import { getAdapter } from '../rmm/registry';
import { parseId } from '../util/ids';

interface IdParam { id: string }

export async function deviceRoutes(server: FastifyInstance) {
  // List devices with optional filtering
  server.get('/devices', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, string>;
    const devices = await deviceRepo.list({
      companyName: query.company,
      source: query.source as DeviceSource | undefined,
      status: query.status,
      probeId: query.probeId ? parseInt(query.probeId) : undefined,
      page: query.page ? parseInt(query.page) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize) : 100,
    });
    return reply.send(devices);
  });

  // Get one device with its ticket links
  server.get('/devices/:id', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid device id' });
    const device = await deviceRepo.getById(id);
    if (!device) return reply.status(404).send({ error: 'Device not found' });
    return reply.send(device);
  });

  // Fetch current details directly from the device's RMM. The local device
  // remains the source of truth; this endpoint is an on-open operational glance.
  server.get('/devices/:id/live', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid device id' });
    const device = await deviceRepo.getById(id);
    if (!device) return reply.status(404).send({ error: 'Device not found' });

    const adapter = getAdapter(device.source);
    if (!adapter || !device.externalId) {
      return reply.status(409).send({ error: 'Live data is only available for RMM-managed devices' });
    }
    if (!adapter.isConfigured()) {
      return reply.status(503).send({ error: `${adapter.label} is not configured` });
    }

    try {
      const live = await adapter.live(device.externalId);
      // Fall back to the stored hostname when the RMM omits it.
      if (live.hostname == null) live.hostname = device.hostname ?? device.displayName ?? null;
      return reply.send(live);
    } catch (err) {
      server.log.warn({ err, deviceId: id, source: device.source }, 'RMM live device lookup failed');
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  // Create a device manually (standalone — no RMM required)
  server.post('/devices', async (req: FastifyRequest, reply: FastifyReply) => {
    const device = await deviceRepo.create(req.body as deviceRepo.CreateDeviceInput, req.actorSub);
    return reply.status(201).send(device);
  });

  // Update device fields
  server.patch('/devices/:id', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const device = await deviceRepo.update(
      parseInt(req.params.id),
      req.body as deviceRepo.UpdateDeviceInput,
      req.actorSub
    );
    if (!device) return reply.status(404).send({ error: 'Device not found' });
    return reply.send(device);
  });

  // Delete a device
  server.delete('/devices/:id', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const device = await deviceRepo.remove(parseInt(req.params.id), req.actorSub);
    if (!device) return reply.status(404).send({ error: 'Device not found' });
    return reply.status(204).send();
  });

  // Device revision history
  server.get('/devices/:id/history', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const history = await audit.getHistory('device', parseInt(req.params.id));
    return reply.send(history);
  });

  // --- ticket <-> device linking (the kanban card cockpit) ---

  // Devices linked to a ticket
  server.get('/tickets/:id/devices', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const devices = await deviceRepo.listForTicket(parseInt(req.params.id));
    return reply.send(devices);
  });

  // Link a device to a ticket
  server.post('/tickets/:id/devices', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const body = req.body as { deviceId?: number };
    if (!body?.deviceId) return reply.status(400).send({ error: 'deviceId is required' });

    await deviceRepo.link(parseInt(req.params.id), body.deviceId, req.actorSub);
    return reply.status(201).send({ ok: true });
  });

  // Unlink a device from a ticket
  server.delete('/tickets/:id/devices/:deviceId', async (
    req: FastifyRequest<{ Params: { id: string; deviceId: string } }>,
    reply: FastifyReply
  ) => {
    const ok = await deviceRepo.unlink(parseInt(req.params.id), parseInt(req.params.deviceId), req.actorSub);
    if (!ok) return reply.status(404).send({ error: 'Link not found' });
    return reply.status(204).send();
  });
}
