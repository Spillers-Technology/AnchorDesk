import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import path from 'path';
import { config } from '../config/config';

/** Kept deliberately smaller than ticket attachments: this is a profile image. */
export const PORTAL_PROFILE_AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const AVATAR_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export function isPortalProfileAvatarContentType(contentType: string): boolean {
  return AVATAR_CONTENT_TYPES.has(contentType.toLowerCase());
}

/**
 * An avatar is not a ticket attachment, but it shares the same storage
 * strategy. Keep it in a separate, collision-free namespace.
 */
export function buildPortalProfileAvatarKey(userId: number, filename: string): string {
  const safe = path
    .basename(filename)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-120);
  return `portal-avatars/${userId}/${randomUUID()}-${safe || 'avatar'}`;
}

function signature(userId: number, storageKey: string): string {
  return createHmac('sha256', config.sessionSecret)
    .update(`${userId}:${storageKey}`)
    .digest('base64url');
}

/**
 * The URL contains a predictable numeric subject only behind a 256-bit HMAC.
 * It is consequently safe to expose in the portal DTO without making the
 * public avatar endpoint enumerable.
 */
export function portalProfileAvatarToken(userId: number, storageKey: string): string {
  return `${userId}.${signature(userId, storageKey)}`;
}

export function portalProfileAvatarUrl(userId: number, storageKey: string): string {
  return `/api/portal-profile-avatar/${portalProfileAvatarToken(userId, storageKey)}`;
}

export function verifiesPortalProfileAvatarToken(
  token: string,
  userId: number,
  storageKey: string,
): boolean {
  if (!/^\d+\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [tokenUserId, supplied] = token.split('.');
  if (tokenUserId !== String(userId)) return false;
  const expected = signature(userId, storageKey);
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
