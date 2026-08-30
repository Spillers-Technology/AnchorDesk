/**
 * Unit tests for the personal-access-token crypto. These guard the security
 * boundary: a raw token must never be derivable from what we store, and our
 * tokens must be distinguishable from OIDC bearer tokens. DB-free.
 */
import { ApiToken } from '@prisma/client';
import {
  TOKEN_PREFIX,
  generateRawToken,
  hashToken,
  isPatFormat,
  toPublic,
} from '../apiTokens';

describe('PAT generation', () => {
  it('mints a prefixed token with a matching display prefix', () => {
    const { raw, prefix } = generateRawToken();
    expect(raw.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(prefix).toBe(raw.slice(0, 12));
    expect(prefix.startsWith(TOKEN_PREFIX)).toBe(true);
    // adk_ (4) + 32 bytes hex (64) = 68 chars of high-entropy secret.
    expect(raw).toHaveLength(TOKEN_PREFIX.length + 64);
  });

  it('produces a distinct token each call', () => {
    const a = generateRawToken().raw;
    const b = generateRawToken().raw;
    expect(a).not.toBe(b);
  });
});

describe('PAT hashing', () => {
  it('is a deterministic 64-char hex digest that is not the raw token', () => {
    const { raw } = generateRawToken();
    const hash = hashToken(raw);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(raw);
    expect(hash).not.toContain(raw);
    expect(hashToken(raw)).toBe(hash); // deterministic
  });
});

describe('isPatFormat', () => {
  it('accepts our tokens and rejects foreign bearer values', () => {
    expect(isPatFormat(generateRawToken().raw)).toBe(true);
    expect(isPatFormat('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abc')).toBe(false); // JWT-ish
    expect(isPatFormat('')).toBe(false);
  });
});

describe('toPublic', () => {
  it('strips the token hash so the secret material never serializes', () => {
    const row: ApiToken = {
      id: 1,
      userId: 7,
      name: 'Voice agent',
      tokenHash: 'a'.repeat(64),
      prefix: 'adk_deadbeef',
      scope: 'full',
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    const pub = toPublic(row) as Record<string, unknown>;
    expect(pub.tokenHash).toBeUndefined();
    expect(JSON.stringify(pub)).not.toContain('a'.repeat(64));
    expect(pub.prefix).toBe('adk_deadbeef');
  });
});
