import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as scriptService from '../services/scriptService';
import * as scriptJobRepo from '../repositories/scriptJobRepository';
import { syncBySource } from '../services/deviceSyncService';
import { getAdapter, listAdapters } from '../rmm/registry';
import { parseId } from '../util/ids';
import { isPlainRecord } from '../util/objects';
import { requireRole } from '../middleware/auth';
import { normalizeRmmProvider } from './deviceValidation';

interface IdParam { id: string }

interface RunScriptBody {
  script: string | number;
  provider?: string;
  scriptName?: string;
  args?: string[];
  timeout?: number;
  ticketId?: number;
  scheduledFor?: string;
}

function validateRunScriptBody(value: unknown): string | null {
  if (!isPlainRecord(value)) return 'request body must be an object';
  const allowed = new Set(['script', 'provider', 'scriptName', 'args', 'timeout', 'ticketId', 'scheduledFor']);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) return `Unsupported script-run field: ${unknown}`;
  const script = value.script;
  if ((typeof script !== 'string' && typeof script !== 'number') || !String(script).trim()) return 'script is required';
  if (String(script).length > 150) return 'script must be at most 150 characters';
  if (value.provider !== undefined && (typeof value.provider !== 'string' || !value.provider.trim() || value.provider.length > 50)) {
    return 'provider must be a non-empty string up to 50 characters';
  }
  if (value.scriptName !== undefined && (typeof value.scriptName !== 'string' || value.scriptName.length > 255)) {
    return 'scriptName must be a string up to 255 characters';
  }
  if (value.args !== undefined && (!Array.isArray(value.args) || value.args.length > 100
      || value.args.some((arg) => typeof arg !== 'string' || arg.length > 1000))) {
    return 'args must be an array of at most 100 strings up to 1000 characters each';
  }
  if (value.timeout !== undefined
      && (typeof value.timeout !== 'number' || !Number.isInteger(value.timeout) || value.timeout < 1 || value.timeout > 3_600)) {
    return 'timeout must be an integer between 1 and 3600 seconds';
  }
  if (value.ticketId !== undefined
      && (typeof value.ticketId !== 'number' || !Number.isInteger(value.ticketId) || value.ticketId <= 0)) {
    return 'ticketId must be a positive integer';
  }
  if (value.scheduledFor !== undefined
      && (typeof value.scheduledFor !== 'string' || Number.isNaN(new Date(value.scheduledFor).getTime()))) {
    return 'scheduledFor must be a valid date';
  }
  return null;
}

export async function scriptRoutes(server: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('admin') };
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
    const rawProvider = (req.query as Record<string, unknown>).provider;
    let providerKey = 'tactical_rmm';
    if (rawProvider !== undefined) {
      try {
        providerKey = normalizeRmmProvider(rawProvider);
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
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
    const deviceId = parseId(req.params.id);
    if (deviceId === null) return reply.status(400).send({ error: 'invalid device id' });
    const validationError = validateRunScriptBody(req.body);
    if (validationError) return reply.status(400).send({ error: validationError });
    const body = req.body as unknown as RunScriptBody;
    if (body.provider !== undefined) {
      try {
        body.provider = normalizeRmmProvider(body.provider);
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }

    try {
      const job = await scriptService.runOrSchedule(
        {
          deviceId,
          provider: body.provider,
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
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid device id' });
    const jobs = await scriptJobRepo.listForDevice(id);
    return reply.send(jobs);
  });

  // Script runs launched from a ticket.
  server.get('/tickets/:id/script-jobs', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid ticket id' });
    const jobs = await scriptJobRepo.listForTicket(id);
    return reply.send(jobs);
  });

  // Single job (poll a scheduled job's result).
  server.get('/script-jobs/:id', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.status(400).send({ error: 'invalid job id' });
    let job = await scriptJobRepo.getById(id);
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    if (job.status === 'running' && job.invocationId) {
      job = await scriptService.refresh(id).catch((error) => {
        req.log.warn({ error, scriptJobId: id }, 'script job refresh failed');
        return job;
      });
    }
    return reply.send(job);
  });

  // Pull devices from an RMM into the local table. `?provider=` selects which
  // RMM; defaults to Tactical for back-compat.
  server.post('/devices/sync', adminOnly, async (req: FastifyRequest, reply: FastifyReply) => {
    const rawProvider = (req.query as Record<string, unknown>).provider;
    let providerKey = 'tactical_rmm';
    if (rawProvider !== undefined) {
      try {
        providerKey = normalizeRmmProvider(rawProvider);
      } catch (error) {
        return reply.status(400).send({ error: (error as Error).message });
      }
    }
    const adapter = getAdapter(providerKey);
    if (!adapter) return reply.status(404).send({ error: `Unknown RMM "${providerKey}"` });
    if (!adapter.isConfigured()) return reply.status(503).send({ error: `${adapter.label} is not configured` });
    const result = await syncBySource(providerKey, req.actorSub);
    return reply.send(result);
  });
}
