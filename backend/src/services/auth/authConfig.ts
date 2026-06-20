/**
 * Effective auth configuration.
 *
 * Source of truth is the single-row `auth_settings` table, editable from the
 * Admin UI. On first boot we seed it from env vars (OIDC_*, SAML_*, AUTH_*) so
 * a deployment can be fully configured by environment alone — but once an admin
 * edits a setting, the DB row wins.
 *
 * Secrets (OIDC client secret) are stored but NEVER serialized back to clients;
 * the public view exposes only booleans/non-secret fields.
 */
import { AuthSetting } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { config } from '../../config/config';

let cached: AuthSetting | null = null;

/** Build the OIDC callback URL, honoring an explicit override. */
export function oidcRedirectUri(s: AuthSetting): string {
  return s.oidcRedirectUri || `${config.appBaseUrl}/api/auth/oidc/callback`;
}

export function samlCallbackUrl(): string {
  return `${config.appBaseUrl}/api/auth/saml/callback`;
}

/** Seed the row from env on first boot; no-op if it already exists. */
export async function ensureAuthSettings(): Promise<AuthSetting> {
  const existing = await prisma.authSetting.findUnique({ where: { id: 1 } });
  if (existing) return existing;

  const seeded = await prisma.authSetting.create({
    data: {
      id: 1,
      localEnabled: config.authLocalEnabled,
      oidcEnabled: !!config.oidcIssuerUrl,
      oidcIssuerUrl: config.oidcIssuerUrl || null,
      oidcClientId: config.oidcClientId || null,
      oidcClientSecret: config.oidcClientSecret || null,
      oidcRedirectUri: config.oidcRedirectUri || null,
      samlEnabled: !!config.saml.entryPoint,
      samlEntryPoint: config.saml.entryPoint || null,
      samlIssuer: config.saml.issuer || null,
      samlIdpCert: config.saml.idpCert || null,
      mfaRequired: config.mfaRequired,
      mfaIssuer: config.mfaIssuer,
    },
  });
  cached = seeded;
  return seeded;
}

export async function getAuthSettings(): Promise<AuthSetting> {
  if (cached) return cached;
  cached = (await prisma.authSetting.findUnique({ where: { id: 1 } })) ?? (await ensureAuthSettings());
  return cached;
}

export interface UpdateAuthSettingsInput {
  localEnabled?: boolean;
  oidcEnabled?: boolean;
  oidcIssuerUrl?: string | null;
  oidcClientId?: string | null;
  oidcClientSecret?: string | null; // write-only; '' = leave unchanged
  oidcRedirectUri?: string | null;
  samlEnabled?: boolean;
  samlEntryPoint?: string | null;
  samlIssuer?: string | null;
  samlIdpCert?: string | null;
  mfaRequired?: boolean;
  mfaIssuer?: string | null;
}

export async function updateAuthSettings(input: UpdateAuthSettingsInput): Promise<AuthSetting> {
  await ensureAuthSettings();
  const data: Record<string, unknown> = { ...input };
  // An empty secret means "keep the existing one" — don't blank it out.
  if (input.oidcClientSecret === '' || input.oidcClientSecret == null) delete data.oidcClientSecret;
  const updated = await prisma.authSetting.update({ where: { id: 1 }, data });
  cached = updated;
  return updated;
}

/** Non-secret view for the Admin UI and the login screen. */
export function toPublicSettings(s: AuthSetting) {
  return {
    localEnabled: s.localEnabled,
    oidc: {
      enabled: s.oidcEnabled && !!s.oidcIssuerUrl && !!s.oidcClientId,
      issuerUrl: s.oidcIssuerUrl,
      clientId: s.oidcClientId,
      redirectUri: oidcRedirectUri(s),
      hasClientSecret: !!s.oidcClientSecret,
    },
    saml: {
      enabled: s.samlEnabled && !!s.samlEntryPoint && !!s.samlIdpCert,
      entryPoint: s.samlEntryPoint,
      issuer: s.samlIssuer,
      callbackUrl: samlCallbackUrl(),
      hasIdpCert: !!s.samlIdpCert,
    },
    mfa: {
      required: s.mfaRequired,
      issuer: s.mfaIssuer ?? 'MaterialTicket',
    },
  };
}

/** Minimal view for the unauthenticated login screen (which buttons to show). */
export function toLoginOptions(s: AuthSetting) {
  const pub = toPublicSettings(s);
  return { local: pub.localEnabled, oidc: pub.oidc.enabled, saml: pub.saml.enabled };
}
