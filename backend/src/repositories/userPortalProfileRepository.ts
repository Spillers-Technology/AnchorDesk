import { Prisma, UserPortalProfile } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';

export type UserPortalProfileRow = UserPortalProfile;

export interface UserPortalProfileInput {
  displayName: string | null;
  publicEmail: string | null;
  publicPhone: string | null;
  optedIn: boolean;
}

export function findForUser(userId: number): Promise<UserPortalProfileRow | null> {
  return prisma.userPortalProfile.findUnique({ where: { userId } });
}

export async function updateForUser(
  userId: number,
  input: UserPortalProfileInput,
  actorSub: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<UserPortalProfileRow> {
  const before = await db.userPortalProfile.findUnique({ where: { userId } });
  const row = await db.userPortalProfile.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
  });
  await audit.record({
    entityType: 'user_portal_profile',
    entityId: userId,
    action: before ? 'update' : 'create',
    changedBy: actorSub,
    oldValue: before
      ? {
          displayName: before.displayName,
          publicEmail: before.publicEmail,
          publicPhone: before.publicPhone,
          optedIn: before.optedIn,
        }
      : null,
    newValue: { ...input },
  }, db);
  return row;
}

export async function setAvatarForUser(
  userId: number,
  avatar: { storageKey: string; contentType: string; storageBackend: string },
  actorSub: string,
): Promise<{
  profile: UserPortalProfileRow;
  previousStorageKey: string | null;
  previousStorageBackend: string | null;
}> {
  const before = await prisma.userPortalProfile.findUnique({ where: { userId } });
  const profile = await prisma.userPortalProfile.upsert({
    where: { userId },
    create: {
      userId,
      avatarStorageKey: avatar.storageKey,
      avatarContentType: avatar.contentType,
      avatarStorageBackend: avatar.storageBackend,
    },
    update: {
      avatarStorageKey: avatar.storageKey,
      avatarContentType: avatar.contentType,
      avatarStorageBackend: avatar.storageBackend,
    },
  });
  await audit.record({
    entityType: 'user_portal_profile',
    entityId: userId,
    action: before ? 'update' : 'create',
    changedBy: actorSub,
    oldValue: { hasAvatar: !!before?.avatarStorageKey },
    newValue: { hasAvatar: true },
  });
  return {
    profile,
    previousStorageKey: before?.avatarStorageKey ?? null,
    previousStorageBackend: before?.avatarStorageBackend ?? null,
  };
}

/** Only consented profiles can be considered by a public avatar handler. */
export function findPublicAvatar(userId: number): Promise<UserPortalProfileRow | null> {
  return prisma.userPortalProfile.findFirst({
    where: {
      userId,
      optedIn: true,
      avatarStorageKey: { not: null },
      avatarContentType: { not: null },
    },
  });
}
