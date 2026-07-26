import { createHash, randomBytes } from 'crypto';
import { config } from '../../config/config';
import * as portalAuthRepository from '../../repositories/portalAuthRepository';
import type { RequesterPrincipal } from '../../types/principal';
import { mailTransport } from '../mail/SmtpMailTransport';
import {
  generateSessionToken,
  hashSessionToken,
  PORTAL_SESSION_TTL_MS,
  safeEqual,
} from './sessions';

export const PORTAL_MAGIC_PREFIX = 'adp_';
export const PORTAL_MAGIC_TTL_MS = 15 * 60 * 1000;

const SELECTOR_BYTES = 16; // 128 bits: non-secret row locator
const VERIFIER_BYTES = 32; // 256-bit bearer secret
const SELECTOR_LENGTH = 22; // base64url without padding
const VERIFIER_LENGTH = 43;
const DUMMY_DIGEST = createHash('sha256')
  .update('anchordesk-portal-magic-link-dummy')
  .digest('hex');

export interface GeneratedMagicToken {
  raw: string;
  selectorHash: string;
  verifierHash: string;
}

export interface RedeemedPortalSession {
  requester: RequesterPrincipal;
  sessionToken: string;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateMagicToken(): GeneratedMagicToken {
  const selector = randomBytes(SELECTOR_BYTES).toString('base64url');
  const verifier = randomBytes(VERIFIER_BYTES).toString('base64url');
  return {
    raw: `${PORTAL_MAGIC_PREFIX}${selector}.${verifier}`,
    selectorHash: sha256Hex(selector),
    verifierHash: sha256Hex(verifier),
  };
}

export function parseMagicToken(
  raw: string,
): { selector: string; verifier: string } | null {
  if (typeof raw !== 'string' || raw.length > 128) return null;
  const pattern = new RegExp(
    `^${PORTAL_MAGIC_PREFIX}([A-Za-z0-9_-]{${SELECTOR_LENGTH}})\\.([A-Za-z0-9_-]{${VERIFIER_LENGTH}})$`,
  );
  const match = raw.match(pattern);
  return match ? { selector: match[1], verifier: match[2] } : null;
}

/**
 * Conservative normalization only. Do not apply provider-specific plus/dot
 * rules: two distinct Contact addresses must never collapse into one identity.
 */
export function normalizePortalEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || /[\r\n\s]/.test(email)) return null;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1 || email.indexOf('@') !== at) return null;
  return email;
}

/**
 * Issue and mail a link when an address maps to exactly one Contact.
 *
 * This function intentionally returns no existence/delivery result. Its route
 * invokes it after responding so contact lookup, database writes, and SMTP
 * latency cannot become an HTTP email-enumeration oracle.
 */
export async function requestMagicLink(emailInput: unknown): Promise<void> {
  const email = normalizePortalEmail(emailInput);
  if (!email) return;
  if (!(await mailTransport.isConfigured())) return;

  const requester =
    await portalAuthRepository.findUniqueRequesterByEmail(email);
  if (!requester) return;

  const token = generateMagicToken();
  const created = await portalAuthRepository.createMagicLink({
    contactId: requester.contactId,
    expectedCompanyId: requester.companyId,
    expectedEmail: email,
    selectorHash: token.selectorHash,
    verifierHash: token.verifierHash,
    expiresAt: new Date(Date.now() + PORTAL_MAGIC_TTL_MS),
  });
  if (!created) return;

  const link = `${config.appBaseUrl}/portal/login#token=${encodeURIComponent(token.raw)}`;
  await mailTransport.send({
    to: requester.email,
    subject: 'Sign in to AnchorDesk',
    text:
      `Use this single-use link to sign in to the AnchorDesk customer portal:\n\n` +
      `${link}\n\nThis link expires in 15 minutes. If you did not request it, you can ignore this email.`,
  });
}

/**
 * Verify the secret in constant time, then atomically consume the link and
 * create a fresh 24-hour portal session. Invalid, expired, and replayed tokens
 * are intentionally indistinguishable to callers.
 */
export async function redeemMagicLink(
  rawInput: unknown,
  requestMeta: { userAgent?: string; ip?: string },
): Promise<RedeemedPortalSession | null> {
  const raw = typeof rawInput === 'string' ? rawInput : '';
  const parsed = parseMagicToken(raw);

  // Even malformed tokens take the selector lookup + fixed-digest comparison
  // path. Nothing compares raw secrets or variable-length buffers.
  const selectorHash = sha256Hex(parsed?.selector ?? 'invalid-selector');
  const presentedVerifierHash = sha256Hex(
    parsed?.verifier ?? 'invalid-verifier',
  );
  const candidate =
    await portalAuthRepository.findMagicLinkBySelectorHash(selectorHash);
  const verifierMatches = safeEqual(
    presentedVerifierHash,
    candidate?.verifierHash ?? DUMMY_DIGEST,
  );
  if (!parsed || !candidate || !verifierMatches) return null;

  const now = new Date();
  const sessionToken = generateSessionToken();
  const requester =
    await portalAuthRepository.consumeMagicLinkAndCreateSession({
      linkId: candidate.id,
      contactId: candidate.contactId,
      now,
      actor: `requester:${candidate.contactId} (portal)`,
      session: {
        tokenHash: hashSessionToken(sessionToken),
        userAgent:
          requestMeta.userAgent?.slice(0, 255).trim() || null,
        ip: requestMeta.ip?.slice(0, 45) || null,
        expiresAt: new Date(now.getTime() + PORTAL_SESSION_TTL_MS),
      },
    });
  return requester ? { requester, sessionToken } : null;
}

export const pruneExpiredMagicLinks =
  portalAuthRepository.pruneExpiredMagicLinks;
