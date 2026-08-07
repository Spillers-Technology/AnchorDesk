/**
 * Authentication routes: login screen config, the three login flows
 * (local / OIDC / SAML), logout, current-user, and self password change.
 *
 * The public endpoints here are exempted from the auth hook (see
 * middleware/auth.ts `isPublic`). Everything is mounted at /auth and reached by
 * the browser through the /api proxy as /api/auth/*.
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/config';
import * as userRepo from '../repositories/userRepository';
import * as portalProfileRepo from '../repositories/userPortalProfileRepository';
import { verifyPassword, hashPassword, MIN_PASSWORD_LENGTH } from '../services/auth/password';
import { createSession, destroySession, SESSION_COOKIE } from '../services/auth/sessions';
import { getAuthSettings, toLoginOptions, oidcRedirectUri } from '../services/auth/authConfig';
import * as oidcService from '../services/auth/oidcService';
import * as samlService from '../services/auth/samlService';
import * as totp from '../services/auth/totp';
import { resolveSession } from '../services/auth/sessions';
import { sanitizeEmailHtml } from '../services/mail/sanitizeHtml';
import { currentStorage, storageForBackend } from '../services/storage';
import {
  buildPortalProfileAvatarKey,
  isPortalProfileAvatarContentType,
  PORTAL_PROFILE_AVATAR_MAX_BYTES,
  portalProfileAvatarUrl,
  verifiesPortalProfileAvatarToken,
} from '../services/portalProfileAvatar';
import { getPortal } from '../services/settingsService';

const OIDC_TX_COOKIE = 'mt_oidc_tx';
const MFA_COOKIE = 'mt_mfa';

// Known UI palette ids (mirrors web-client/src/theme.ts PALETTES). Used to
// validate the /auth/theme preference so only real palette ids are persisted.
const THEME_IDS = new Set([
  'default-light',
  'default-dark',
  'solarized-light',
  'solarized-dark',
  'nord',
  'gruvbox',
  'dracula',
]);

type MfaScope = 'verify' | 'enroll';

interface AvatarTokenParam {
  token: string;
}

function profileDto(profile: {
  userId: number;
  displayName: string | null;
  avatarStorageKey: string | null;
  publicEmail: string | null;
  publicPhone: string | null;
  optedIn: boolean;
}) {
  return {
    displayName: profile.displayName,
    avatarUrl: profile.avatarStorageKey
      ? portalProfileAvatarUrl(profile.userId, profile.avatarStorageKey)
      : null,
    publicEmail: profile.publicEmail,
    publicPhone: profile.publicPhone,
    optedIn: profile.optedIn,
  };
}

function optionalTrimmedString(value: unknown, field: string, maxLength: number): string | null | Error {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return new Error(`${field} must be a string or null`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return new Error(`${field} must be at most ${maxLength} characters`);
  return trimmed || null;
}

function portalProfileBody(value: unknown):
  | { displayName: string | null; publicEmail: string | null; publicPhone: string | null; optedIn: boolean }
  | Error {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return new Error('request body must be an object');
  }
  const body = value as Record<string, unknown>;
  const supported = new Set(['displayName', 'publicEmail', 'publicPhone', 'optedIn']);
  const unexpected = Object.keys(body).filter((key) => !supported.has(key));
  if (unexpected.length) return new Error(`unsupported field${unexpected.length === 1 ? '' : 's'}: ${unexpected.join(', ')}`);
  if (typeof body.optedIn !== 'boolean') return new Error('optedIn must be a boolean');
  const displayName = optionalTrimmedString(body.displayName, 'displayName', 150);
  const publicEmail = optionalTrimmedString(body.publicEmail, 'publicEmail', 255);
  const publicPhone = optionalTrimmedString(body.publicPhone, 'publicPhone', 50);
  if (displayName instanceof Error) return displayName;
  if (publicEmail instanceof Error) return publicEmail;
  if (publicPhone instanceof Error) return publicPhone;
  if (publicEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publicEmail)) {
    return new Error('publicEmail must be a valid email address');
  }
  return { displayName, publicEmail, publicPhone, optedIn: body.optedIn };
}

/** Identify the acting user from either a live session or a pre-session MFA cookie. */
async function mfaActor(
  req: FastifyRequest
): Promise<{ userId: number; scope: MfaScope | 'session' } | null> {
  const sessionUser = await resolveSession(req.cookies?.[SESSION_COOKIE]);
  if (sessionUser) return { userId: sessionUser.id, scope: 'session' };

  const raw = req.cookies?.[MFA_COOKIE];
  const unsigned = raw ? req.unsignCookie(raw) : { valid: false, value: null };
  if (unsigned.valid && unsigned.value) {
    try {
      const parsed = JSON.parse(unsigned.value) as { userId: number; scope: MfaScope };
      return { userId: parsed.userId, scope: parsed.scope };
    } catch {
      /* ignore */
    }
  }
  return null;
}

function txCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.appBaseUrl.startsWith('https://'),
    path: '/',
    signed: true,
    maxAge: maxAgeSec,
  };
}

export async function authRoutes(server: FastifyInstance) {
  // Which login methods to render on the login screen.
  server.get('/auth/config', async (_req, reply) => {
    const settings = await getAuthSettings();
    return reply.send(toLoginOptions(settings));
  });

  // Throttle credential-guessing on the password + MFA endpoints.
  const loginThrottle = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  // ─── First-run setup wizard ────────────────────────────────────────────────
  // Both endpoints derive their gate from the DB (users table empty), never a
  // flag file: once any user exists they refuse to act, so the surface closes
  // itself the moment setup completes (or bootstrap/SSO created a user first).

  server.get('/auth/setup-status', async (_req, reply) => {
    const settings = await getAuthSettings();
    const needed = settings.localEnabled && (await userRepo.count()) === 0;
    return reply.send({ needed });
  });

  server.post('/auth/setup', loginThrottle, async (req: FastifyRequest, reply: FastifyReply) => {
    const settings = await getAuthSettings();
    if (!settings.localEnabled) return reply.status(403).send({ error: 'Local accounts are disabled — sign in with SSO instead' });
    if ((await userRepo.count()) > 0) return reply.status(403).send({ error: 'Setup is already complete — sign in instead' });

    const { username, password, displayName, email } = (req.body ?? {}) as {
      username?: string; password?: string; displayName?: string; email?: string;
    };
    if (!username?.trim() || !password) return reply.status(400).send({ error: 'username and password are required' });
    if (password.length < MIN_PASSWORD_LENGTH) {
      return reply.status(400).send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const passwordHash = await hashPassword(password);
    const admin = await userRepo.createLocal(
      {
        username: username.trim().slice(0, 100),
        passwordHash,
        email: email?.trim() || undefined,
        role: 'admin',
        displayName: displayName?.trim() || username.trim(),
      },
      'setup-wizard',
    );
    req.log.info(`First-run setup created admin '${admin.username}' (id ${admin.id}).`);
    return reply.status(201).send({ ok: true, username: admin.username });
  });

  // ─── Local username/password ───────────────────────────────────────────────
  server.post('/auth/login', loginThrottle, async (req: FastifyRequest, reply: FastifyReply) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (!username || !password) return reply.status(400).send({ error: 'username and password required' });

    const settings = await getAuthSettings();
    if (!settings.localEnabled) return reply.status(403).send({ error: 'Local login is disabled' });

    const user = await userRepo.findLocalByUsername(username);
    // Always run a hash comparison to keep timing uniform whether or not the
    // user exists; never reveal which of username/password was wrong.
    const ok = await verifyPassword(password, user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinv');
    if (!user || !ok || !user.isActive) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // MFA gate. A user with TOTP active must present a code; a user who hasn't
    // enrolled but is required to must enroll before getting a session.
    if (user.totpEnabled) {
      reply.setCookie(MFA_COOKIE, JSON.stringify({ userId: user.id, scope: 'verify' }), txCookieOptions(300));
      return reply.send({ mfaRequired: true });
    }
    if (settings.mfaRequired) {
      reply.setCookie(MFA_COOKIE, JSON.stringify({ userId: user.id, scope: 'enroll' }), txCookieOptions(600));
      return reply.send({ enrollmentRequired: true });
    }

    await createSession(reply, req, user);
    return reply.send({ user: userRepo.toPublic(user) });
  });

  // ─── MFA (TOTP) ──────────────────────────────────────────────────────────────

  // Verify a TOTP (or recovery) code to finish a login for an enrolled user.
  server.post('/auth/mfa/verify', loginThrottle, async (req: FastifyRequest, reply: FastifyReply) => {
    const { code } = (req.body ?? {}) as { code?: string };
    if (!code) return reply.status(400).send({ error: 'code required' });

    const actor = await mfaActor(req);
    if (!actor || actor.scope === 'enroll') return reply.status(401).send({ error: 'No pending MFA challenge' });

    const user = await userRepo.findById(actor.userId);
    if (!user || !user.isActive || !user.totpEnabled || !user.totpSecret) {
      return reply.status(401).send({ error: 'MFA not available for this account' });
    }

    const codeOk =
      totp.verifyToken(user.totpSecret, code) ||
      (await userRepo.consumeRecoveryCode(user.id, totp.hashRecoveryCode(code)));
    if (!codeOk) return reply.status(401).send({ error: 'Invalid code' });

    reply.clearCookie(MFA_COOKIE, { path: '/' });
    await createSession(reply, req, user);
    return reply.send({ user: userRepo.toPublic(user) });
  });

  // Begin enrollment: stage a secret and return the otpauth URL + QR image.
  server.post('/auth/mfa/setup', async (req: FastifyRequest, reply: FastifyReply) => {
    const actor = await mfaActor(req);
    if (!actor) return reply.status(401).send({ error: 'Authentication required' });

    const user = await userRepo.findById(actor.userId);
    if (!user || user.authProvider !== 'local') {
      return reply.status(400).send({ error: 'MFA is only for local accounts' });
    }

    const settings = await getAuthSettings();
    const secret = totp.generateSecret();
    await userRepo.stageTotpSecret(user.id, secret);
    const otpauthUrl = totp.buildOtpauthUrl(user.username, settings.mfaIssuer ?? 'AnchorDesk', secret);
    const qr = await totp.qrDataUrl(otpauthUrl);
    return reply.send({ otpauthUrl, qr, secret });
  });

  // Confirm enrollment with a code; return one-time recovery codes.
  server.post('/auth/mfa/enable', async (req: FastifyRequest, reply: FastifyReply) => {
    const { code } = (req.body ?? {}) as { code?: string };
    if (!code) return reply.status(400).send({ error: 'code required' });

    const actor = await mfaActor(req);
    if (!actor) return reply.status(401).send({ error: 'Authentication required' });

    const user = await userRepo.findById(actor.userId);
    if (!user || !user.totpSecret) return reply.status(400).send({ error: 'No staged MFA secret — run setup first' });
    if (!totp.verifyToken(user.totpSecret, code)) return reply.status(401).send({ error: 'Invalid code' });

    const { codes, hashes } = totp.generateRecoveryCodes();
    await userRepo.enableTotp(user.id, hashes, user.username);

    // If this was the pre-session enrollment flow, log them in now.
    if (actor.scope === 'enroll') {
      reply.clearCookie(MFA_COOKIE, { path: '/' });
      await createSession(reply, req, user);
    }
    return reply.send({ ok: true, recoveryCodes: codes, user: userRepo.toPublic({ ...user, totpEnabled: true }) });
  });

  // Disable own MFA (requires a live session; blocked when policy requires MFA).
  server.delete('/auth/mfa', async (req: FastifyRequest, reply: FastifyReply) => {
    const sessionUser = await resolveSession(req.cookies?.[SESSION_COOKIE]);
    if (!sessionUser) return reply.status(401).send({ error: 'Authentication required' });

    const settings = await getAuthSettings();
    if (settings.mfaRequired && sessionUser.role !== 'admin') {
      return reply.status(403).send({ error: 'MFA is required by policy and cannot be disabled' });
    }
    await userRepo.disableTotp(sessionUser.id, sessionUser.username);
    return reply.send({ ok: true });
  });

  server.post('/auth/logout', async (req: FastifyRequest, reply: FastifyReply) => {
    await destroySession(reply, req.cookies?.[SESSION_COOKIE]);
    return reply.send({ ok: true });
  });

  // Current authenticated user (requires auth — not public).
  server.get('/auth/me', async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ user: req.user });
  });

  // Own email signature (sanitized HTML). Read for the composer/account editor.
  server.get('/auth/signature', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await userRepo.findById(req.user.id);
    return reply.send({ signatureHtml: user?.signatureHtml ?? '' });
  });

  server.put('/auth/signature', async (req: FastifyRequest, reply: FastifyReply) => {
    const { signatureHtml } = (req.body ?? {}) as { signatureHtml?: string };
    const clean = signatureHtml ? sanitizeEmailHtml(signatureHtml) : null;
    await userRepo.setSignature(req.user.id, clean);
    return reply.send({ signatureHtml: clean ?? '' });
  });

  // Own UI theme preference (a palette id). Validated against the known set;
  // null/unknown resets to the app default. The dev-admin (id 0) has no user row,
  // so its choice is not persisted (the client still applies it locally).
  server.put('/auth/theme', async (req: FastifyRequest, reply: FastifyReply) => {
    const { themePref } = (req.body ?? {}) as { themePref?: string | null };
    const value = themePref && THEME_IDS.has(themePref) ? themePref : null;
    if (req.user.id !== 0) await userRepo.setThemePref(req.user.id, value);
    return reply.send({ themePref: value });
  });

  // Own Kanban board columns: an ordered array of status names to show.
  // Null/empty resets to the default (all statuses). Statuses are free strings
  // in the schema, so validation is shape-only (bounded strings, capped count).
  server.put('/auth/kanban-columns', async (req: FastifyRequest, reply: FastifyReply) => {
    const { kanbanColumns } = (req.body ?? {}) as { kanbanColumns?: unknown };
    if (kanbanColumns !== null && !Array.isArray(kanbanColumns)) {
      return reply.status(400).send({ error: 'kanbanColumns must be an array or null' });
    }
    if (Array.isArray(kanbanColumns) && kanbanColumns.length > 20) {
      return reply.status(400).send({ error: 'kanbanColumns may contain at most 20 statuses' });
    }
    if (Array.isArray(kanbanColumns) && kanbanColumns.some((s) => typeof s !== 'string' || !s.trim() || s.length > 100)) {
      return reply.status(400).send({ error: 'kanbanColumns must contain non-empty status strings up to 100 characters' });
    }
    const cleaned = Array.isArray(kanbanColumns)
      ? [...new Set((kanbanColumns as string[]).map((status) => status.trim()))]
      : [];
    const value = cleaned.length > 0 ? cleaned : null;
    if (req.user.id !== 0) await userRepo.setKanbanColumns(req.user.id, value);
    return reply.send({ kanbanColumns: value });
  });

  // Technician-owned portal identity. Login email is deliberately absent from
  // this surface: publishing it is an explicit, separate choice.
  server.get('/auth/portal-profile', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user.id === 0) {
      return reply.send(profileDto({
        userId: 0,
        displayName: null,
        avatarStorageKey: null,
        publicEmail: null,
        publicPhone: null,
        optedIn: false,
      }));
    }
    const profile = await portalProfileRepo.findForUser(req.user.id);
    return reply.send(profileDto(profile ?? {
      userId: req.user.id,
      displayName: null,
      avatarStorageKey: null,
      publicEmail: null,
      publicPhone: null,
      optedIn: false,
    }));
  });

  server.put('/auth/portal-profile', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = portalProfileBody(req.body);
    if (body instanceof Error) return reply.status(400).send({ error: body.message });
    if (req.user.id === 0) {
      return reply.send(profileDto({ userId: 0, avatarStorageKey: null, ...body }));
    }
    const profile = await portalProfileRepo.updateForUser(req.user.id, body, req.actorSub);
    return reply.send(profileDto(profile));
  });

  server.post('/auth/portal-profile/avatar', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user.id === 0) return reply.status(409).send({ error: 'Portal profile avatars are unavailable for the dev account' });
    if (!req.isMultipart()) return reply.status(400).send({ error: 'Expected multipart/form-data' });

    let upload: { filename: string; contentType: string; buffer: Buffer } | null = null;
    try {
      for await (const part of req.files()) {
        if (upload) {
          part.file.resume();
          return reply.status(400).send({ error: 'Upload exactly one avatar image' });
        }
        const contentType = part.mimetype.toLowerCase();
        if (!isPortalProfileAvatarContentType(contentType)) {
          part.file.resume();
          return reply.status(400).send({ error: 'Avatar must be a PNG, JPEG, GIF, or WebP image' });
        }
        const buffer = await part.toBuffer();
        if (buffer.length > PORTAL_PROFILE_AVATAR_MAX_BYTES) {
          return reply.status(413).send({ error: 'Avatar must be 2 MB or smaller' });
        }
        upload = { filename: part.filename, contentType, buffer };
      }
    } catch (error) {
      const uploadError = error as { code?: string };
      if (uploadError.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.status(413).send({ error: 'Avatar must be 2 MB or smaller' });
      }
      req.log.warn({ err: error }, 'Portal profile avatar upload failed');
      return reply.status(400).send({ error: 'Avatar upload failed' });
    }
    if (!upload) return reply.status(400).send({ error: 'Upload exactly one avatar image' });

    const storage = await currentStorage();
    const storageKey = buildPortalProfileAvatarKey(req.user.id, upload.filename);
    await storage.put(storageKey, upload.buffer, upload.contentType);
    try {
      const { profile, previousStorageKey, previousStorageBackend } = await portalProfileRepo.setAvatarForUser(
        req.user.id,
        { storageKey, contentType: upload.contentType, storageBackend: storage.backend },
        req.actorSub,
      );
      if (previousStorageKey && previousStorageKey !== storageKey) {
        // The prior avatar may have been written under a different admin-
        // selected default; delete it from the backend it actually lives on,
        // not whichever backend is current now.
        const previousStorage = await storageForBackend(previousStorageBackend ?? 'local');
        await previousStorage.delete(previousStorageKey).catch((error) => {
          req.log.warn({ err: error }, 'Previous portal profile avatar cleanup failed');
        });
      }
      return reply.status(201).send(profileDto(profile));
    } catch (error) {
      await storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  });

  // This endpoint is intentionally public. A response is admitted only while
  // both the shop's named-identity setting and the technician's opt-in remain
  // true; its HMAC URL is unguessable and no-store makes either revocation take
  // effect on the next image request.
  server.get<{ Params: AvatarTokenParam }>('/portal-profile-avatar/:token', async (req, reply) => {
    const match = /^(\d+)\.[A-Za-z0-9_-]{43}$/.exec(req.params.token);
    if (!match) return reply.status(404).send({ error: 'Avatar not found' });
    const userId = Number(match[1]);
    if (!Number.isSafeInteger(userId) || userId <= 0) return reply.status(404).send({ error: 'Avatar not found' });
    const [portal, profile] = await Promise.all([getPortal(), portalProfileRepo.findPublicAvatar(userId)]);
    if (
      portal.technicianIdentity !== 'named' ||
      !profile?.avatarStorageKey ||
      !profile.avatarContentType ||
      !verifiesPortalProfileAvatarToken(req.params.token, userId, profile.avatarStorageKey)
    ) {
      return reply.status(404).send({ error: 'Avatar not found' });
    }
    try {
      const storage = await storageForBackend(profile.avatarStorageBackend ?? 'local');
      const stream = await storage.get(profile.avatarStorageKey);
      reply.header('Content-Type', profile.avatarContentType);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Cache-Control', 'no-store');
      return reply.send(stream);
    } catch (error) {
      req.log.warn({ err: error }, 'Portal profile avatar fetch failed');
      return reply.status(404).send({ error: 'Avatar not found' });
    }
  });

  // Change own password (local accounts only).
  server.post('/auth/password', async (req: FastifyRequest, reply: FastifyReply) => {
    const { currentPassword, newPassword } = (req.body ?? {}) as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!newPassword) return reply.status(400).send({ error: 'newPassword required' });

    const user = await userRepo.findById(req.user.id);
    if (!user || user.authProvider !== 'local') {
      return reply.status(400).send({ error: 'Password change is only for local accounts' });
    }
    if (!(await verifyPassword(currentPassword ?? '', user.passwordHash))) {
      return reply.status(401).send({ error: 'Current password is incorrect' });
    }
    try {
      const hash = await hashPassword(newPassword);
      await userRepo.setPassword(user.id, hash, user.username);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
    // Password change kills sessions; re-issue one so the user stays logged in.
    await createSession(reply, req, user);
    return reply.send({ ok: true });
  });

  // ─── OIDC SSO ───────────────────────────────────────────────────────────────
  server.get('/auth/oidc/login', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { url, state, nonce, codeVerifier } = await oidcService.startLogin();
      reply.setCookie(OIDC_TX_COOKIE, JSON.stringify({ state, nonce, codeVerifier }), txCookieOptions(600));
      return reply.redirect(url);
    } catch (err) {
      return reply.status(500).send({ error: `OIDC login unavailable: ${(err as Error).message}` });
    }
  });

  server.get('/auth/oidc/callback', async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = req.cookies?.[OIDC_TX_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : { valid: false, value: null };
    if (!unsigned.valid || !unsigned.value) {
      return reply.status(400).send({ error: 'Missing or invalid OIDC transaction' });
    }
    reply.clearCookie(OIDC_TX_COOKIE, { path: '/' });

    try {
      const checks = JSON.parse(unsigned.value) as { state: string; nonce: string; codeVerifier: string };
      const settings = await getAuthSettings();
      // Reconstruct the exact registered redirect URI + the incoming query.
      const currentUrl = new URL(oidcRedirectUri(settings));
      currentUrl.search = new URL(req.url, config.appBaseUrl).search;

      const result = await oidcService.completeLogin(currentUrl.href, checks);
      const user = await userRepo.upsertSso({
        provider: 'oidc',
        subject: result.subject,
        username: result.username,
        displayName: result.displayName,
        email: result.email,
      });
      if (!user.isActive) return reply.status(403).send({ error: 'Account is disabled' });

      await createSession(reply, req, user);
      return reply.redirect(config.appBaseUrl);
    } catch (err) {
      req.log.warn({ err }, 'OIDC callback failed');
      return reply.redirect(`${config.appBaseUrl}/?authError=oidc`);
    }
  });

  // ─── SAML SSO ─────────────────────────────────────────────────────────────────
  server.get('/auth/saml/login', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const url = await samlService.startLogin('/');
      return reply.redirect(url);
    } catch (err) {
      return reply.status(500).send({ error: `SAML login unavailable: ${(err as Error).message}` });
    }
  });

  // ACS endpoint — the IdP POSTs the signed SAMLResponse here (form-encoded).
  server.post('/auth/saml/callback', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = (req.body ?? {}) as { SAMLResponse?: string };
      if (!body.SAMLResponse) return reply.status(400).send({ error: 'Missing SAMLResponse' });

      const result = await samlService.completeLogin(body.SAMLResponse);
      const user = await userRepo.upsertSso({
        provider: 'saml',
        subject: result.subject,
        username: result.username,
        displayName: result.displayName,
        email: result.email,
      });
      if (!user.isActive) return reply.status(403).send({ error: 'Account is disabled' });

      await createSession(reply, req, user);
      return reply.redirect(config.appBaseUrl);
    } catch (err) {
      req.log.warn({ err }, 'SAML callback failed');
      return reply.redirect(`${config.appBaseUrl}/?authError=saml`);
    }
  });

  server.get('/auth/saml/metadata', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const xml = await samlService.metadata();
      return reply.type('application/xml').send(xml);
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });
}
