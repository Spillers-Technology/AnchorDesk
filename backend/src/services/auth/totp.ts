/**
 * TOTP multi-factor auth for local accounts (RFC 6238).
 *
 * Standard authenticator-app flow: we generate a base32 secret, hand the user
 * an otpauth:// URL (rendered as a QR code) to scan, and confirm enrollment by
 * verifying a code. SSO users get MFA from their IdP, so TOTP is local-only.
 *
 * Recovery codes are single-use; we store only their SHA-256 hashes and show
 * the raw codes exactly once at enrollment.
 */
import { createHash, randomBytes } from 'crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';

// Allow ±1 time-step (±30s) of clock drift between server and authenticator.
authenticator.options = { window: 1 };

export function generateSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpauthUrl(account: string, issuer: string, secret: string): string {
  return authenticator.keyuri(account, issuer, secret);
}

export async function qrDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}

export function verifyToken(secret: string, token: string): boolean {
  if (!secret || !token) return false;
  try {
    return authenticator.check(token.replace(/\s/g, ''), secret);
  } catch {
    return false;
  }
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');
}

/** Generate N human-friendly recovery codes + their hashes for storage. */
export function generateRecoveryCodes(n = 10): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < n; i++) {
    const raw = randomBytes(5).toString('hex'); // 10 hex chars
    const pretty = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    codes.push(pretty);
    hashes.push(hashRecoveryCode(pretty));
  }
  return { codes, hashes };
}
