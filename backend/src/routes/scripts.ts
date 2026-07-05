import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as scriptService from '../services/scriptService';
import * as scriptJobRepo from '../repositories/scriptJobRepository';
import { syncBySource } from '../services/deviceSyncService';
import { getAdapter, listAdapters } from '../rmm/registry';

interface IdParam { id: string }

interface RunScriptBody {
  script: string | number;
  scriptName?: string;
  args?: string[];
  timeout?: number;
  ticketId?: number;
  scheduledFor?: string;
}

export async function scriptRoutes(server: FastifyInstance) {
  // Whether RMM features are usable (drives the UI). Reports every registered
  // RMM plus a back-compat `tactical` shortcut.
  server.get('/rmm/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    const providers = listAdapters().map((a) => ({
      key: a.key,
      label: a.label,
      configured: a.isConfigured(),
      hasScriptCatalog: a.hasScriptCatalog,
    }));
    const tactical = providers.find((p) => p.key === 'tactical_rmm');
    return reply.send({ providers, tactical: { configured: !!tactical?.configured } });
  });

  // Script catalog for the run-script picker. `?provider=` selects the RMM; it
  // defaults to Tactical for back-compat. Providers without a catalog (Datto)
  // return [] and the UI collects a component UID by hand.
  server.get('/scripts', async (req: FastifyRequest, reply: FastifyReply) => {
    const providerKey = (req.query as Record<string, string>).provider || 'tactical_rmm';
    const adapter = getAdapter(providerKey);
    if (!adapter || !adapter.isConfigured() || !adapter.hasScriptCatalog) return reply.send([]);
    try {
      return reply.send(await adapter.listScripts());
    } catch (err) {
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  // Run (or schedule) a script against a device.
  server.post('/devices/:id/run-script', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const body = req.body as RunScriptBody;
    if (body?.script == null) return reply.status(400).send({ error: 'script is required' });

    try {
      const job = await scriptService.runOrSchedule(
        {
          deviceId: parseInt(req.params.id),
          script: String(body.script),
          scriptName: body.scriptName,
          args: body.args,
          timeout: body.timeout,
          ticketId: body.ticketId,
          scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
        },
        req.actorSub
      );
      return reply.status(201).send(job);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
  });

  // Script run history for a device.
  server.get('/devices/:id/script-jobs', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const jobs = await scriptJobRepo.listForDevice(parseInt(req.params.id));
    return reply.send(jobs);
  });

  // Script runs launched from a ticket.
  server.get('/tickets/:id/script-jobs', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const jobs = await scriptJobRepo.listForTicket(parseInt(req.params.id));
    return reply.send(jobs);
  });

  // Single job (poll a scheduled job's result).
  server.get('/script-jobs/:id', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const job = await scriptJobRepo.getById(parseInt(req.params.id));
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    return reply.send(job);
  });

  // Pull devices from an RMM into the local table. `?provider=` selects which
  // RMM; defaults to Tactical for back-compat.
  server.post('/devices/sync', async (req: FastifyRequest, reply: FastifyReply) => {
    const providerKey = (req.query as Record<string, string>).provider || 'tactical_rmm';
    const adapter = getAdapter(providerKey);
    if (!adapter) return reply.status(404).send({ error: `Unknown RMM "${providerKey}"` });
    if (!adapter.isConfigured()) return reply.status(503).send({ error: `${adapter.label} is not configured` });
    const result = await syncBySource(providerKey, req.actorSub);
    return reply.send(result);
  });
}
