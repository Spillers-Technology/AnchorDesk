/**
 * Symmetric encryption for secrets stored at rest (e.g. IMAP mailbox passwords).
 *
 * AES-256-GCM with a random IV per value; output is `iv:authTag:ciphertext`
 * (all base64). The key is ENCRYPTION_KEY (64 hex chars = 32 bytes). GCM gives
 * us authentication, so tampering is detected on decrypt.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../config/config';

const ALGO = 'aes-256-gcm';

function key(): Buffer {
  const hex = config.encryptionKey;
  // Accept 64 hex (32 bytes). Anything else is padded/truncated to 32 bytes so a
  // misconfigured key still boots in dev (it just won't decrypt prod data).
  const buf = Buffer.from(hex, 'hex');
  if (buf.length === 32) return buf;
  const out = Buffer.alloc(32);
  Buffer.from(hex).copy(out);
  return out;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const [ivB64, tagB64, ctB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !ctB64) return null;
  try {
    const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}
