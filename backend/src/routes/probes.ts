import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Probe, ProbeStatus } from '@prisma/client';
import * as probeRepo from '../repositories/probeRepository';
import * as deviceRepo from '../repositories/deviceRepository';
import { NetVizProvider } from '../providers/NetVizProvider';
import { requireRole } from '../middleware/auth';

interface IdParam { id: string }

/** Resolve the calling probe from the X-Probe-Key header. */
async function authProbe(req: FastifyRequest, reply: FastifyReply): Promise<Probe | null> {
  const key = req.headers['x-probe-key'];
  if (typeof key !== 'string' || !key) {
    reply.status(401).send({ error: 'Missing X-Probe-Key' });
    return null;
  }
  const probe = await probeRepo.findByApiKey(key);
  if (!probe) {
    reply.status(401).send({ error: 'Invalid probe key' });
    return null;
  }
  return probe;
}

export async function probeRoutes(server: FastifyInstance) {
  // --- admin (OIDC) ---

  server.get('/probes', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(await probeRepo.list());
  });

  // Register a probe — apiKey is returned ONCE here and never again.
  server.post('/probes', { preHandler: requireRole('admin') }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as probeRepo.CreateProbeInput;
    if (!body?.name) return reply.status(400).send({ error: 'name is required' });

    const probe = await probeRepo.create(body, req.actorSub);
    return reply.status(201).send(probe); // includes apiKey
  });

  // Update a probe — primarily to associate it with a Company (which then flows
  // to its discovered devices on the next ingest).
  server.patch<{ Params: IdParam }>('/probes/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const body = (req.body ?? {}) as probeRepo.UpdateProbeInput;
    const probe = await probeRepo.update(parseInt(req.params.id), body, req.actorSub);
    if (!probe) return reply.status(404).send({ error: 'Probe not found' });
    return reply.send(probe);
  });

  server.delete<{ Params: IdParam }>('/probes/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const probe = await probeRepo.remove(parseInt(req.params.id), req.actorSub);
    if (!probe) return reply.status(404).send({ error: 'Probe not found' });
    return reply.status(204).send();
  });

  // --- probe self-service (X-Probe-Key, OIDC-exempt via /probe/ prefix) ---

  // Heartbeat: keeps status/version fresh so the UI can show "probe online".
  server.post('/probe/heartbeat', async (req: FastifyRequest, reply: FastifyReply) => {
    const probe = await authProbe(req, reply);
    if (!probe) return;

    const body = (req.body ?? {}) as { status?: ProbeStatus; version?: string; cidr?: string };
    const updated = await probeRepo.heartbeat(probe.id, body);
    return reply.send(updated);
  });

  // Device ingest: the probe POSTs raw netviz scan records; we normalize via the
  // provider (it owns the contract) and upsert into the local Device table.
  server.post('/probe/devices', async (req: FastifyRequest, reply: FastifyReply) => {
    const probe = await authProbe(req, reply);
    if (!probe) return;

    const body = req.body as { devices?: Record<string, unknown>[] };
    const records = Array.isArray(body?.devices) ? body.devices : [];
    if (records.length === 0) return reply.status(400).send({ error: 'devices[] is required' });

    const provider = new NetVizProvider(probe.companyName ?? undefined);
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const raw of records) {
      try {
        const ext = provider.normalize(raw);
        const { created: wasCreated } = await deviceRepo.upsertExternal(
          ext.externalId,
          provider.name,
          {
            hostname: ext.hostname,
            displayName: ext.displayName,
            ipAddress: ext.ipAddress,
            macAddress: ext.macAddress,
            vendor: ext.vendor,
            assetTag: ext.assetTag,
            serialNumber: ext.serialNumber,
            manufacturer: ext.manufacturer,
            model: ext.model,
            location: ext.location,
            purchaseDate: ext.purchaseDate,
            warrantyExpiresAt: ext.warrantyExpiresAt,
            notes: ext.notes,
            os: ext.os,
            deviceType: ext.deviceType,
            openPorts: ext.openPorts,
            status: ext.status,
            companyName: ext.companyName ?? probe.companyName ?? undefined,
            companyId: probe.companyId ?? undefined,
            source: 'netviz',
            probeId: probe.id,
            firstSeenAt: ext.firstSeenAt,
            lastSeenAt: ext.lastSeenAt ?? new Date(),
            metadata: ext.metadata,
          },
          'probe'
        );
        wasCreated ? created++ : updated++;
      } catch (err) {
        errors.push((err as Error).message);
      }
    }

    // A successful ingest implies the probe is alive.
    await probeRepo.heartbeat(probe.id, { status: 'online' });

    return reply.send({ received: records.length, created, updated, errors });
  });
}
