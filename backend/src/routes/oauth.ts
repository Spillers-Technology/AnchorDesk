/**
 * OAuth 2.0 authorization-server HTTP endpoints, scoped to MCP.
 *
 * These make AnchorDesk its own authorization server so MCP clients (ChatGPT's
 * connector) can complete OAuth without depending on the customer's IdP. The
 * flow and rationale live in services/auth/oauthProvider.ts; this file is only
 * the HTTP wiring + the server-rendered consent screen.
 *
 * All four endpoints are exempt from the normal auth hook (see publicPaths.ts):
 * register/token authenticate via the OAuth handshake itself, and authorize
 * resolves the session cookie by hand so it can bounce an unauthenticated user
 * to the login screen instead of returning a bare 401.
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/config';
import { resolveSession, SESSION_COOKIE } from '../services/auth/sessions';
import {
  AUTH_SERVER_METADATA_PATH,
  buildAuthServerMetadata,
  registerClient,
  validateAuthorizeRequest,
  issueCode,
  exchangeCode,
  errorRedirect,
  consentCsrfToken,
  verifyConsentCsrf,
  OAuthError,
  RedirectableOAuthError,
  AuthorizeParams,
  ValidatedAuthorizeRequest,
} from '../services/auth/oauthProvider';

const rateLimit = (max: number) => ({
  rateLimit: { max, timeWindow: '1 minute' },
});

export async function oauthRoutes(app: FastifyInstance) {
  // ── Authorization Server Metadata (RFC 8414) ──
  app.get(AUTH_SERVER_METADATA_PATH, async (_req, reply) => {
    return reply.send(buildAuthServerMetadata());
  });

  // ── Dynamic Client Registration (RFC 7591) ──
  app.post('/oauth/register', { config: rateLimit(20) }, async (req, reply) => {
    try {
      const result = await registerClient((req.body ?? {}) as Record<string, unknown>);
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof OAuthError) {
        return reply.status(err.status).send({ error: err.code, error_description: err.description });
      }
      req.log.error({ err }, 'OAuth client registration failed');
      return reply.status(500).send({ error: 'server_error' });
    }
  });

  // ── Authorization endpoint (consent) ──
  app.get('/oauth/authorize', { config: rateLimit(60) }, async (req, reply) => {
    const params = req.query as AuthorizeParams;

    let validated: ValidatedAuthorizeRequest;
    try {
      validated = await validateAuthorizeRequest(params);
    } catch (err) {
      return handleAuthorizeError(err, reply);
    }

    // Require an interactive AnchorDesk session. If there isn't one, bounce the
    // browser to the SPA login carrying this request so we come back here after.
    const sessionToken = req.cookies?.[SESSION_COOKIE];
    const user = await resolveSession(sessionToken);
    if (!user || !sessionToken) {
      const returnTo = encodeURIComponent(req.url);
      return reply.redirect(`${config.appBaseUrl}/?oauth_return=${returnTo}`);
    }

    const csrf = consentCsrfToken(sessionToken);
    reply.type('text/html');
    return reply.send(renderConsent(validated, user.displayName || user.username, csrf));
  });

  // ── Authorization decision (approve / deny) ──
  app.post('/oauth/authorize', { config: rateLimit(60) }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string>;

    let validated: ValidatedAuthorizeRequest;
    try {
      validated = await validateAuthorizeRequest(body as AuthorizeParams);
    } catch (err) {
      return handleAuthorizeError(err, reply);
    }

    const sessionToken = req.cookies?.[SESSION_COOKIE];
    const user = await resolveSession(sessionToken);
    if (!user || !sessionToken) {
      // Session lapsed between rendering consent and submitting — restart cleanly.
      return reply.redirect(errorRedirect(validated.redirectUri, 'access_denied', validated.state, 'Session expired'));
    }
    if (!verifyConsentCsrf(sessionToken, body.csrf ?? '')) {
      return reply.status(400).send({ error: 'invalid_request', error_description: 'Bad CSRF token' });
    }

    if (body.decision !== 'approve') {
      return reply.redirect(errorRedirect(validated.redirectUri, 'access_denied', validated.state));
    }

    const redirectUrl = await issueCode(validated, user.id);
    return reply.redirect(redirectUrl);
  });

  // ── Token endpoint ──
  app.post('/oauth/token', { config: rateLimit(60) }, async (req, reply) => {
    try {
      const result = await exchangeCode((req.body ?? {}) as Record<string, string>);
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');
      return reply.send(result);
    } catch (err) {
      if (err instanceof OAuthError) {
        return reply.status(err.status).send({ error: err.code, error_description: err.description });
      }
      req.log.error({ err }, 'OAuth token exchange failed');
      return reply.status(500).send({ error: 'server_error' });
    }
  });
}

function handleAuthorizeError(err: unknown, reply: FastifyReply) {
  if (err instanceof RedirectableOAuthError) {
    return reply.redirect(errorRedirect(err.redirectUri, err.code, err.state, err.description));
  }
  if (err instanceof OAuthError) {
    // Can't safely redirect (untrusted/unknown client or redirect_uri) — show it.
    reply.type('text/html');
    return reply.status(err.status).send(renderError(err.description));
  }
  throw err;
}

// ─── Server-rendered pages ───────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function hidden(name: string, value: string | undefined): string {
  if (value === undefined || value === null) return '';
  return `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;
}

function pageShell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f4f6f8; color: #1a2027; padding: 24px;
  }
  .card {
    width: 100%; max-width: 420px; background: #fff; border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,.12); padding: 32px; text-align: center;
  }
  .brand { font-size: 13px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #1976d2; margin-bottom: 20px; }
  h1 { font-size: 20px; margin: 0 0 8px; font-weight: 600; }
  p { font-size: 14px; line-height: 1.5; color: #55636e; margin: 8px 0; }
  .who { background: #f0f4f8; border-radius: 8px; padding: 12px 16px; margin: 20px 0; font-size: 14px; }
  .who strong { color: #1a2027; }
  .scope { display: inline-block; background: #e3f2fd; color: #1565c0; border-radius: 6px; padding: 3px 10px; font-size: 12px; font-weight: 600; margin-top: 4px; }
  .actions { display: flex; gap: 12px; margin-top: 24px; }
  button {
    flex: 1; padding: 11px 16px; border-radius: 8px; font-size: 14px; font-weight: 600;
    cursor: pointer; border: 1px solid transparent;
  }
  .approve { background: #1976d2; color: #fff; }
  .approve:hover { background: #1565c0; }
  .deny { background: transparent; color: #55636e; border-color: #cfd8dc; }
  .deny:hover { background: #f0f4f8; }
  form { display: contents; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f1418; color: #e3e8ec; }
    .card { background: #1a2027; box-shadow: 0 8px 32px rgba(0,0,0,.5); }
    h1 { color: #e3e8ec; }
    p { color: #9aa7b2; }
    .who { background: #232b33; }
    .who strong { color: #e3e8ec; }
    .deny { color: #9aa7b2; border-color: #37424c; }
    .deny:hover { background: #232b33; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">AnchorDesk</div>
    ${inner}
  </div>
</body>
</html>`;
}

function renderConsent(req: ValidatedAuthorizeRequest, who: string, csrf: string): string {
  const clientName = req.client.clientName || 'An application';
  const inner = `
    <h1>Authorize ${esc(clientName)}</h1>
    <p><strong>${esc(clientName)}</strong> is requesting access to your AnchorDesk workspace.</p>
    <div class="who">
      Signed in as <strong>${esc(who)}</strong><br>
      <span class="scope">MCP tools</span>
    </div>
    <p>Approving lets it read and create tickets, notes, time entries, and send ticket email as you. You can revoke access anytime from <strong>Account → API tokens</strong>.</p>
    <form method="post" action="/oauth/authorize">
      ${hidden('response_type', 'code')}
      ${hidden('client_id', req.client.clientId)}
      ${hidden('redirect_uri', req.redirectUri)}
      ${hidden('code_challenge', req.codeChallenge)}
      ${hidden('code_challenge_method', 'S256')}
      ${hidden('scope', req.scope)}
      ${hidden('state', req.state)}
      ${hidden('resource', req.resource)}
      ${hidden('csrf', csrf)}
      <div class="actions">
        <button class="deny" type="submit" name="decision" value="deny">Cancel</button>
        <button class="approve" type="submit" name="decision" value="approve">Approve</button>
      </div>
    </form>`;
  return pageShell(`Authorize ${clientName}`, inner);
}

function renderError(message: string): string {
  const inner = `
    <h1>Authorization error</h1>
    <p>${esc(message)}</p>
    <p>Close this window and try connecting again.</p>`;
  return pageShell('Authorization error', inner);
}
