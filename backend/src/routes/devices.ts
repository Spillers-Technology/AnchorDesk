import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DeviceSource } from '@prisma/client';
import * as deviceRepo from '../repositories/deviceRepository';
import * as audit from '../repositories/auditRepository';
import { getAdapter } from '../rmm/registry';
import { parseId } from '../util/ids';
import { requireRole } from '../middleware/auth';
import {
  DevicePayloadValidationError,
  hasLegacyIdentityMutation,
  normalizeRmmProvider,
  validateDevicePayload,
  validateExternalRefPayload,
} from './deviceValidation';

interface IdParam { id: string }
interface ExternalRefParams { id: string; refId: string }

async function requireAdminForLegacyIdentity(request: FastifyRequest, reply: FastifyReply) {
  if (hasLegacyIdentityMutation(request.body) && request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Requires role: admin' });
  }
}

function validationError(reply: FastifyReply, error: unknown): FastifyReply | null {
  if (!(error instanceof DevicePayloadValidationError)) return null;
  return reply.status(400).send({ error: error.message });
}

export async function deviceRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };
  const legacyIdentityAdmin = { preHandler: requireAdminForLegacyIdentity };
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

    const rawProvider = (req.query as Record<string, unknown>).provider;
    let requestedProvider: string | undefined;
    if (rawProvider !== undefined) {
      try {
        requestedProvider = normalizeRmmProvider(rawProvider);
      } catch (error) {
        return validationError(reply, error) ?? reply.status(400).send({ error: 'invalid provider' });
      }
    }
    const ref = await deviceRepo.getExternalRefForProvider(id, requestedProvider);
    const legacyMatchesRequest = !!requestedProvider
      && requestedProvider === device.externalProvider
      && !!device.externalId;
    if (requestedProvider && !ref && !legacyMatchesRequest) {
      return reply.status(409).send({
        error: `Device is not linked to provider "${requestedProvider}"`,
      });
    }
    const provider = ref?.provider
      ?? (requestedProvider && legacyMatchesRequest ? requestedProvider : device.externalProvider);
    const externalId = ref?.externalId
      ?? (provider && provider === device.externalProvider ? device.externalId : null);
    const adapter = provider ? getAdapter(provider) : undefined;
    if (!adapter || !externalId) {
      return reply.status(409).send({ error: 'Live data is only available for RMM-managed devices' });
    }
    if (!adapter.isConfigured()) {
      return reply.status(503).send({ error: `${adapter.label} is not configured` });
    }

    try {
      const live = await adapter.live(externalId);
      // Fall back to the stored hostname when the RMM omits it.
      if (live.hostname == null) live.hostname = device.hostname ?? device.displayName ?? null;
      return reply.send(live);
    } catch (err) {
      server.log.warn({ err, deviceId: id, provider }, 'RMM live device lookup failed');
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  server.get('/devices/:id/external-refs', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid device id' });
    const device = await deviceRepo.getById(id);
    if (!device) return reply.status(404).send({ error: 'Device not found' });
    return reply.send(await deviceRepo.listExternalRefs(id));
  });

  server.post<{ Params: IdParam }>('/devices/:id/external-refs', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid device id' });
    let body: deviceRepo.ExternalRefInput;
    try {
      body = validateExternalRefPayload(req.body) as unknown as deviceRepo.ExternalRefInput;
    } catch (error) {
      return validationError(reply, error) ?? reply.status(400).send({ error: 'invalid external reference' });
    }
    try {
      const ref = await deviceRepo.addExternalRef(id, body, req.actorSub);
      if (!ref) return reply.status(404).send({ error: 'Device not found' });
      return reply.status(201).send(ref);
    } catch (error) {
      return reply.status(409).send({ error: (error as Error).message });
    }
  });

  server.delete<{ Params: ExternalRefParams }>('/devices/:id/external-refs/:refId', adminOnly, async (req, reply) => {
    const id = parseId(req.params.id);
    const refId = parseId(req.params.refId);
    if (id === null || refId === null) return reply.status(400).send({ error: 'invalid id' });
    const removed = await deviceRepo.removeExternalRef(id, refId, req.actorSub);
    if (!removed) return reply.status(404).send({ error: 'External reference not found' });
    return reply.status(204).send();
  });

  // Create a device manually (standalone — no RMM required)
  server.post('/devices', legacyIdentityAdmin, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const input = validateDevicePayload(req.body, 'create') as unknown as deviceRepo.CreateDeviceInput;
      const device = await deviceRepo.create(input, req.actorSub);
      return reply.status(201).send(device);
    } catch (error) {
      const response = validationError(reply, error);
      if (response) return response;
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  // Update device fields
  server.patch<{ Params: IdParam }>('/devices/:id', legacyIdentityAdmin, async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid device id' });
    try {
      const input = validateDevicePayload(req.body, 'patch') as unknown as deviceRepo.UpdateDeviceInput;
      const device = await deviceRepo.update(id, input, req.actorSub);
      if (!device) return reply.status(404).send({ error: 'Device not found' });
      return reply.send(device);
    } catch (error) {
      return reply.status(400).send({ error: (error as Error).message });
    }
  });

  // Delete a device
  server.delete('/devices/:id', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid device id' });
    const device = await deviceRepo.remove(id, req.actorSub);
    if (!device) return reply.status(404).send({ error: 'Device not found' });
    return reply.status(204).send();
  });

  // Device revision history
  server.get('/devices/:id/history', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid device id' });
    const history = await audit.getHistory('device', id);
    return reply.send(history);
  });

  // --- ticket <-> device linking (the kanban card cockpit) ---

  // Devices linked to a ticket
  server.get('/tickets/:id/devices', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const devices = await deviceRepo.listForTicket(id);
    return reply.send(devices);
  });

  // Link a device to a ticket
  server.post('/tickets/:id/devices', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const body = req.body as { deviceId?: number };
    if (!body?.deviceId) return reply.status(400).send({ error: 'deviceId is required' });

    await deviceRepo.link(id, body.deviceId, req.actorSub);
    return reply.status(201).send({ ok: true });
  });

  // Unlink a device from a ticket
  server.delete('/tickets/:id/devices/:deviceId', async (
    req: FastifyRequest<{ Params: { id: string; deviceId: string } }>,
    reply: FastifyReply
  ) => {
    const id = parseId(req.params.id);
    const deviceId = parseId(req.params.deviceId);
    if (id === null || deviceId === null) return reply.status(400).send({ error: 'invalid id' });
    const ok = await deviceRepo.unlink(id, deviceId, req.actorSub);
    if (!ok) return reply.status(404).send({ error: 'Link not found' });
    return reply.status(204).send();
  });
}
