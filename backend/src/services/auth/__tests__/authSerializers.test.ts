/**
 * Guards that serializers never leak secrets and that auth-method enablement is
 * computed correctly. These are the boundaries where a regression would expose a
 * password hash, TOTP secret, or OIDC client secret to a client.
 */
import { AuthSetting, User } from '@prisma/client';
import { toPublic } from '../../../repositories/userRepository';
import { toPublicSettings, toLoginOptions } from '../authConfig';
import { isPublic } from '../../../middleware/publicPaths';

const baseUser: User = {
  id: 1,
  authProvider: 'local',
  subject: null,
  username: 'alice',
  passwordHash: '$2a$12$supersecrethash',
  displayName: 'Alice',
  email: 'alice@example.com',
  role: 'admin',
  isActive: true,
  totpSecret: 'BASE32SECRET',
  totpEnabled: true,
  totpRecovery: ['hash1', 'hash2'],
  lastSeenAt: null,
  passwordChangedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('userRepository.toPublic', () => {
  it('strips passwordHash, totpSecret, and totpRecovery', () => {
    const pub = toPublic(baseUser) as Record<string, unknown>;
    expect(pub.passwordHash).toBeUndefined();
    expect(pub.totpSecret).toBeUndefined();
    expect(pub.totpRecovery).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain('supersecrethash');
    expect(JSON.stringify(pub)).not.toContain('BASE32SECRET');
  });

  it('exposes derived booleans without the secret material', () => {
    const pub = toPublic(baseUser);
    expect(pub.hasPassword).toBe(true);
    expect(pub.mfaEnabled).toBe(true);
    expect(toPublic({ ...baseUser, passwordHash: null, totpEnabled: false }).hasPassword).toBe(false);
  });
});

const baseSettings: AuthSetting = {
  id: 1,
  localEnabled: true,
  oidcEnabled: true,
  oidcIssuerUrl: 'https://idp.example.com',
  oidcClientId: 'client-123',
  oidcClientSecret: 'super-oidc-secret',
  oidcRedirectUri: null,
  samlEnabled: false,
  samlEntryPoint: null,
  samlIssuer: 'materialticket',
  samlIdpCert: null,
  mfaRequired: true,
  mfaIssuer: 'MaterialTicket',
  updatedAt: new Date(),
};

describe('authConfig serializers', () => {
  it('toPublicSettings never includes the OIDC client secret', () => {
    const pub = toPublicSettings(baseSettings);
    expect(JSON.stringify(pub)).not.toContain('super-oidc-secret');
    expect(pub.oidc.hasClientSecret).toBe(true);
  });

  it('computes oidc.enabled only when issuer + clientId present', () => {
    expect(toPublicSettings(baseSettings).oidc.enabled).toBe(true);
    expect(toPublicSettings({ ...baseSettings, oidcClientId: null }).oidc.enabled).toBe(false);
  });

  it('saml.enabled requires entry point + cert', () => {
    expect(toPublicSettings(baseSettings).saml.enabled).toBe(false);
    const withSaml = { ...baseSettings, samlEnabled: true, samlEntryPoint: 'https://idp/sso', samlIdpCert: 'CERT' };
    expect(toPublicSettings(withSaml).saml.enabled).toBe(true);
  });

  it('toLoginOptions reflects enabled methods', () => {
    expect(toLoginOptions(baseSettings)).toEqual({ local: true, oidc: true, saml: false });
  });
});

describe('auth public-path guard', () => {
  it('treats only the intended paths as public', () => {
    expect(isPublic('/ping')).toBe(true);
    expect(isPublic('/probe/devices')).toBe(true);
    expect(isPublic('/auth/login')).toBe(true);
    expect(isPublic('/auth/oidc/callback?code=x')).toBe(true);
    expect(isPublic('/auth/mfa/verify')).toBe(true);
  });

  it('does NOT make protected routes public', () => {
    expect(isPublic('/tickets')).toBe(false);
    expect(isPublic('/users')).toBe(false);
    expect(isPublic('/auth/settings')).toBe(false);
    expect(isPublic('/auth/me')).toBe(false);
    expect(isPublic('/devices')).toBe(false);
  });
});
