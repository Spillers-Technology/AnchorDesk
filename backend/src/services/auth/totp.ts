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
import { generateSecret as otpGenerateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';

// Allow ±30s of clock drift between server and authenticator (otplib 12's
// `window: 1` expressed in v13's epochTolerance seconds). Secrets stay base32,
// so codes enrolled under v12 keep verifying unchanged.
const EPOCH_TOLERANCE_SECONDS = 30;

export function generateSecret(): string {
  return otpGenerateSecret();
}

export function buildOtpauthUrl(account: string, issuer: string, secret: string): string {
  return generateURI({ issuer, label: account, secret });
}

export async function qrDataUrl(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl);
}

export function verifyToken(secret: string, token: string): boolean {
  if (!secret || !token) return false;
  try {
    return verifySync({
      secret,
      token: token.replace(/\s/g, ''),
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
    }).valid;
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
