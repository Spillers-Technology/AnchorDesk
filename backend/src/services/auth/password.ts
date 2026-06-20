/**
 * Password hashing for local accounts.
 *
 * Uses bcrypt (via bcryptjs — pure JS, no native build, so it works identically
 * on Windows dev and Alpine Docker). Cost factor 12 is a sensible 2026 default.
 * Verification is constant-time within bcrypt; we never log or return hashes.
 */
import bcrypt from 'bcryptjs';

const COST = 12;

// A floor so a config typo can't accept a trivially weak password.
export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== 'string' || plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash || !plain) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
