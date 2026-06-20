/**
 * Unit tests for the security-critical auth primitives. No DB required.
 */
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '../password';
import {
  generateSecret,
  buildOtpauthUrl,
  verifyToken,
  generateRecoveryCodes,
  hashRecoveryCode,
} from '../totp';
import { authenticator } from 'otplib';

describe('password hashing', () => {
  it('hashes and verifies a valid password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).not.toContain('correct horse battery'); // never plaintext
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong password!!', hash)).toBe(false);
  });

  it('rejects passwords below the minimum length', async () => {
    await expect(hashPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).rejects.toThrow();
  });

  it('verify returns false for null/empty hash without throwing', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(await verifyPassword('', 'somehash')).toBe(false);
  });
});

describe('TOTP', () => {
  it('builds a valid otpauth URL and verifies a current code', () => {
    const secret = generateSecret();
    const url = buildOtpauthUrl('alice', 'AnchorDesk', secret);
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain('AnchorDesk');

    const code = authenticator.generate(secret);
    expect(verifyToken(secret, code)).toBe(true);
    expect(verifyToken(secret, '000000')).toBe(false);
  });

  it('tolerates spaces in the submitted code', () => {
    const secret = generateSecret();
    const code = authenticator.generate(secret);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyToken(secret, spaced)).toBe(true);
  });
});

describe('recovery codes', () => {
  it('generates the requested count with matching hashes', () => {
    const { codes, hashes } = generateRecoveryCodes(8);
    expect(codes).toHaveLength(8);
    expect(hashes).toHaveLength(8);
    // Hash of the raw code matches the stored hash (case/format-insensitive).
    expect(hashRecoveryCode(codes[0].toUpperCase())).toBe(hashes[0]);
    // Distinct codes produce distinct hashes.
    expect(new Set(hashes).size).toBe(8);
  });
});
