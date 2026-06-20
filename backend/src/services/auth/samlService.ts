/**
 * SAML 2.0 Service Provider login.
 *
 * Wraps @node-saml/node-saml. We act as an SP: redirect the browser to the IdP
 * (AuthnRequest), then validate the signed SAMLResponse POSTed back to the ACS
 * endpoint. Assertion signatures are required; the IdP signing cert comes from
 * the effective AuthSetting (env-seeded, DB-authoritative).
 *
 * InResponseTo validation is disabled (no server-side request cache in v1);
 * security rests on the required, validated assertion signature + audience.
 */
import { SAML, SamlConfig } from '@node-saml/node-saml';
import { AuthSetting } from '@prisma/client';
import { getAuthSettings, samlCallbackUrl } from './authConfig';
import { config } from '../../config/config';

export interface SamlResult {
  subject: string;
  username: string;
  displayName?: string;
  email?: string;
}

let samlCache: { key: string; saml: SAML } | null = null;

function normalizeCert(cert: string): string {
  // Accept either a bare base64 body or a full PEM block.
  const body = cert
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  return body;
}

function build(s: AuthSetting): SAML {
  if (!s.samlEntryPoint || !s.samlIdpCert) throw new Error('SAML is not configured');
  const key = `${s.samlEntryPoint}|${s.samlIssuer}|${s.samlIdpCert.length}`;
  if (samlCache?.key === key) return samlCache.saml;

  const samlConfig: SamlConfig = {
    callbackUrl: samlCallbackUrl(),
    entryPoint: s.samlEntryPoint,
    issuer: s.samlIssuer || config.saml.issuer || 'anchordesk',
    idpCert: normalizeCert(s.samlIdpCert),
    audience: s.samlIssuer || 'anchordesk',
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: 'never' as SamlConfig['validateInResponseTo'],
    acceptedClockSkewMs: 5000,
  };
  const saml = new SAML(samlConfig);
  samlCache = { key, saml };
  return saml;
}

export function resetSamlCache() {
  samlCache = null;
}

/** Build the IdP redirect URL. relayState round-trips through the IdP. */
export async function startLogin(relayState: string): Promise<string> {
  const s = await getAuthSettings();
  const saml = build(s);
  return saml.getAuthorizeUrlAsync(relayState, undefined, {});
}

const EMAIL_CLAIMS = [
  'email',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'urn:oid:0.9.2342.19200300.100.1.3',
];
const NAME_CLAIMS = [
  'displayName',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  'urn:oid:2.16.840.1.113730.3.1.241',
  'cn',
];

function pick(attrs: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0]) return v[0];
  }
  return undefined;
}

/** Validate the SAMLResponse POST body and extract the identity. */
export async function completeLogin(samlResponse: string): Promise<SamlResult> {
  const s = await getAuthSettings();
  const saml = build(s);

  const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
  if (!profile || !profile.nameID) throw new Error('SAML response missing nameID');

  const attrs = (profile.attributes ?? {}) as Record<string, unknown>;
  const email = (typeof profile.email === 'string' ? profile.email : undefined) ?? pick(attrs, EMAIL_CLAIMS);
  const displayName = pick(attrs, NAME_CLAIMS);

  return {
    subject: String(profile.nameID),
    username: email ?? String(profile.nameID),
    displayName,
    email,
  };
}

/** SP metadata XML for IdP-side configuration. */
export async function metadata(): Promise<string> {
  const s = await getAuthSettings();
  const saml = build(s);
  return saml.generateServiceProviderMetadata(null, null);
}
