import fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { ticketRoutes } from './routes/tickets';
import { attachmentRoutes } from './routes/attachments';
import { notificationRoutes } from './routes/notifications';
import { slaRoutes } from './routes/sla';
import { labelRoutes } from './routes/labels';
import { wsRoutes } from './routes/ws';
import { deviceRoutes } from './routes/devices';
import { probeRoutes } from './routes/probes';
import { scriptRoutes } from './routes/scripts';
import { mailRoutes } from './routes/mail';
import { mailConfigRoutes } from './routes/mailConfig';
import { cwRoutes } from './routes/cw';
import { syncRoutes } from './routes/sync';
import { pingRoutes } from './routes/ping';
import { mcpRoutes } from './routes/mcp';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { integrationRoutes } from './routes/integrations';
import { adminRoutes } from './routes/admin';
import { companyRoutes } from './routes/companies';
import { registerAuthHook } from './middleware/auth';
import { bootstrapAuth } from './services/auth/bootstrap';
import { pruneExpiredSessions } from './services/auth/sessions';
import { seedSettings } from './services/settingsService';
import { ensurePgExtras } from './db/pgExtras';
import { startScriptScheduler } from './services/scriptScheduler';
import { startImapScheduler } from './services/imapScheduler';
import { startSlaScheduler } from './services/slaScheduler';
import { initWsHub } from './services/realtime/wsHub';
import { initNotificationService } from './services/notificationService';
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

  // Multipart uploads (ticket attachments). 25 MB per file; files are streamed
  // into the configured storage backend, not buffered to a temp dir by the plugin.
  await server.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

  // WebSocket transport for live updates (notifications, ticket/SLA changes).
  // Routes opt in with { websocket: true }; the normal auth hook still runs on
  // the upgrade request so only authenticated users get a socket.
  await server.register(websocket);

  // Parse JSON request bodies. Body-less POSTs (e.g. /devices/sync, logout) often
  // still send `Content-Type: application/json` with an empty body — treat that as
  // no body instead of JSON.parse('') throwing "Unexpected end of JSON input".
  server.addContentTypeParser('application/json', { parseAs: 'string' }, function (_req, body, done) {
    const str = (body as string).trim();
    if (str === '') {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(str));
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
  // Admin: integrations (SMTP/CW/Tactical settings + IMAP mailboxes).
  server.register(integrationRoutes);
  // Admin: console overview + audit-log viewer.
  server.register(adminRoutes);

  // CRM: companies + contacts + company rollups
  server.register(companyRoutes);

  // Core local-DB routes (tickets, notes, history)
  server.register(ticketRoutes);
  // Ticket attachments (upload/download/delete; local-disk or S3 storage)
  server.register(attachmentRoutes);
  // Per-user notifications (bell badge + center)
  server.register(notificationRoutes);
  // SLA policies (admin CRUD) — drives ticket response/resolution deadlines
  server.register(slaRoutes);
  // Labels (managed tags) + ticket tag/untag
  server.register(labelRoutes);
  // Devices (local-first asset records + ticket linking)
  server.register(deviceRoutes);
  // Probes (netviz scanner registration + inbound device ingest)
  server.register(probeRoutes);
  // Scripts / RMM (Tactical device sync + run/schedule scripts on devices)
  server.register(scriptRoutes);
  // Outbound mail (SMTP relay) — send from a ticket, mail status for admin
  server.register(mailRoutes);
  // Mail config: send-from identities + boilerplate templates
  server.register(mailConfigRoutes);
  // ConnectWise passthrough routes (auto-disabled when CWM_* env vars are absent)
  server.register(cwRoutes);
  // Sync management (trigger runs, view providers, view log)
  server.register(syncRoutes);
  // Health check
  server.register(pingRoutes);
  // MCP server — SSE transport at /mcp/sse, messages at /mcp/messages
  server.register(mcpRoutes);
  // WebSocket live-update channel at /ws
  server.register(wsRoutes);

  // Graceful shutdown — close HTTP server then disconnect Prisma
  const shutdown = async () => {
    await server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await server.listen({ port: Number(config.serverPort), host: '0.0.0.0' });
  server.log.info(`anchordesk backend listening on :${config.serverPort}`);

  // Postgres-specific indexes (full-text search + partial indexes).
  await ensurePgExtras(server.log).catch((err) => server.log.error({ err }, 'pgExtras failed'));

  // First-boot auth bootstrap (seed settings + create admin if users table empty).
  await bootstrapAuth(server.log).catch((err) => server.log.error({ err }, 'Auth bootstrap failed'));

  // Seed integration settings from env + hydrate runtime config.
  await seedSettings().catch((err) => server.log.error({ err }, 'Settings seed failed'));

  // Wire the WebSocket hub + notification service to the in-process event bus.
  initWsHub();
  initNotificationService();

  // Poll for due scheduled script jobs + inbound email-to-ticket.
  startScriptScheduler(server.log);
  startImapScheduler(server.log);
  // Evaluate SLA timers; emit at-risk / breach events to the live layer.
  startSlaScheduler(server.log);

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
