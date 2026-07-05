/**
 * Guards that serializers never leak secrets and that auth-method enablement is
 * computed correctly. These are the boundaries where a regression would expose a
 * password hash, TOTP secret, or OIDC client secret to a client.
 */
import { AuthSetting, User } from '@prisma/client';
import { toPublic } from '../../../repositories/userRepository';
import { toPublicSettings, toLoginOptions } from '../authConfig';
import { isPublic } from '../../../middleware/publicPaths';
import {
  buildMcpProtectedResourceMetadata,
  mcpProtectedResourceMetadataUrl,
  mcpWwwAuthenticateHeader,
} from '../mcpOAuth';
import { buildAuthServerMetadata } from '../oauthProvider';

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
  signatureHtml: null,
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
  samlIssuer: 'anchordesk',
  samlIdpCert: null,
  mfaRequired: true,
  mfaIssuer: 'AnchorDesk',
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
    expect(isPublic('/.well-known/oauth-protected-resource')).toBe(true);
    expect(isPublic('/.well-known/oauth-protected-resource/mcp/sse')).toBe(true);
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

describe('MCP OAuth metadata', () => {
  it('advertises AnchorDesk itself as the authorization server', () => {
    expect(buildMcpProtectedResourceMetadata()).toEqual({
      resource: 'http://localhost:5173/mcp/sse',
      authorization_servers: ['http://localhost:5173'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
      resource_name: 'AnchorDesk MCP',
    });
  });

  it('points MCP 401 responses at the public metadata document', () => {
    expect(mcpProtectedResourceMetadataUrl()).toBe('http://localhost:5173/.well-known/oauth-protected-resource');
    expect(mcpWwwAuthenticateHeader()).toBe(
      'Bearer realm="anchordesk-mcp", resource_metadata="http://localhost:5173/.well-known/oauth-protected-resource"',
    );
  });

  it('exposes RFC 8414 authorization-server metadata pointing at our own endpoints', () => {
    expect(buildAuthServerMetadata()).toEqual({
      issuer: 'http://localhost:5173',
      authorization_endpoint: 'http://localhost:5173/oauth/authorize',
      token_endpoint: 'http://localhost:5173/oauth/token',
      registration_endpoint: 'http://localhost:5173/oauth/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp'],
    });
  });
});

describe('OAuth authorization-server public paths', () => {
  it('exempts the discovery + handshake endpoints from the auth hook', () => {
    expect(isPublic('/.well-known/oauth-authorization-server')).toBe(true);
    expect(isPublic('/oauth/register')).toBe(true);
    expect(isPublic('/oauth/authorize?client_id=x')).toBe(true);
    expect(isPublic('/oauth/token')).toBe(true);
  });

  it('does not expose anything else under /oauth as public', () => {
    expect(isPublic('/oauth/clients')).toBe(false);
    expect(isPublic('/oauth')).toBe(false);
  });
});
