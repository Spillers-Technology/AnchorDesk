import fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import { ticketRoutes } from './routes/tickets';
import { deviceRoutes } from './routes/devices';
import { probeRoutes } from './routes/probes';
import { scriptRoutes } from './routes/scripts';
import { mailRoutes } from './routes/mail';
import { cwRoutes } from './routes/cw';
import { syncRoutes } from './routes/sync';
import { pingRoutes } from './routes/ping';
import { mcpRoutes } from './routes/mcp';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { registerAuthHook } from './middleware/auth';
import { bootstrapAuth } from './services/auth/bootstrap';
import { pruneExpiredSessions } from './services/auth/sessions';
import { ensurePgExtras } from './db/pgExtras';
import { startScriptScheduler } from './services/scriptScheduler';
import { config } from './config/config';
import { prisma } from './db/prisma';

async function start() {
  const server = fastify({ logger: true });

  // Cookie parsing (session + signed OIDC transaction cookies) and urlencoded
  // body parsing (SAML ACS posts form-encoded). Registered BEFORE the auth hook
  // so request.cookies is populated when authentication runs.
  await server.register(cookie, { secret: config.sessionSecret });
  await server.register(formbody);

  // Rate limiting is opt-in (global:false) — only routes that set config.rateLimit
  // are throttled. Used to slow brute-force on the auth endpoints. Single-instance
  // in-memory store; swap to a shared store (e.g. Redis) if you scale to replicas.
  await server.register(rateLimit, { global: false });

  // Parse JSON request bodies
  server.addContentTypeParser('application/json', { parseAs: 'string' }, function (_req, body, done) {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Authentication + RBAC — runs on every request except public/exempt paths.
  await registerAuthHook(server);

  // Auth: login flows, session, self-service (public + authed endpoints).
  server.register(authRoutes);
  // Admin: user management + auth settings (admin role required).
  server.register(userRoutes);

  // Core local-DB routes (tickets, notes, history)
  server.register(ticketRoutes);
  // Devices (local-first asset records + ticket linking)
  server.register(deviceRoutes);
  // Probes (netviz scanner registration + inbound device ingest)
  server.register(probeRoutes);
  // Scripts / RMM (Tactical device sync + run/schedule scripts on devices)
  server.register(scriptRoutes);
  // Outbound mail (SMTP relay) — send from a ticket, mail status for admin
  server.register(mailRoutes);
  // ConnectWise passthrough routes (auto-disabled when CWM_* env vars are absent)
  server.register(cwRoutes);
  // Sync management (trigger runs, view providers, view log)
  server.register(syncRoutes);
  // Health check
  server.register(pingRoutes);
  // MCP server — SSE transport at /mcp/sse, messages at /mcp/messages
  server.register(mcpRoutes);

  // Graceful shutdown — close HTTP server then disconnect Prisma
  const shutdown = async () => {
    await server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await server.listen({ port: Number(config.serverPort), host: '0.0.0.0' });
  server.log.info(`materialticket backend listening on :${config.serverPort}`);

  // Postgres-specific indexes (full-text search + partial indexes).
  await ensurePgExtras(server.log).catch((err) => server.log.error({ err }, 'pgExtras failed'));

  // First-boot auth bootstrap (seed settings + create admin if users table empty).
  await bootstrapAuth(server.log).catch((err) => server.log.error({ err }, 'Auth bootstrap failed'));

  // Poll for due scheduled script jobs.
  startScriptScheduler(server.log);

  // Sweep expired sessions hourly.
  setInterval(() => {
    pruneExpiredSessions().catch((err) => server.log.warn({ err }, 'Session prune failed'));
  }, 60 * 60 * 1000).unref();
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
