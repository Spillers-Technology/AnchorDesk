jest.mock('../db/prisma', () => ({
  prisma: {
    userPortalProfile: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));
jest.mock('./auditRepository', () => ({ record: jest.fn() }));

import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import * as profiles from './userPortalProfileRepository';

const db = prisma as unknown as { userPortalProfile: Record<string, jest.Mock> };

describe('userPortalProfileRepository', () => {
  beforeEach(() => jest.clearAllMocks());

  it('upserts only the technician-owned publication fields and audits the mutation', async () => {
    db.userPortalProfile.findUnique.mockResolvedValue(null);
    db.userPortalProfile.upsert.mockResolvedValue({ userId: 7, optedIn: true });

    await profiles.updateForUser(7, {
      displayName: 'Riley',
      publicEmail: 'riley@example.test',
      publicPhone: null,
      optedIn: true,
    }, 'riley');

    expect(db.userPortalProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 7 },
      create: expect.objectContaining({ userId: 7, displayName: 'Riley', optedIn: true }),
      update: expect.objectContaining({ publicEmail: 'riley@example.test' }),
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'user_portal_profile', entityId: 7, action: 'create', changedBy: 'riley',
    }), prisma);
  });

  it('replaces avatar storage coordinates without creating an Attachment row', async () => {
    db.userPortalProfile.findUnique.mockResolvedValue({
      userId: 7, avatarStorageKey: 'old-key', avatarStorageBackend: 's3',
    });
    db.userPortalProfile.upsert.mockResolvedValue({ userId: 7, avatarStorageKey: 'new-key' });

    await expect(profiles.setAvatarForUser(7, {
      storageKey: 'new-key', contentType: 'image/png', storageBackend: 'local',
    }, 'riley')).resolves.toMatchObject({ previousStorageKey: 'old-key', previousStorageBackend: 's3' });

    expect(db.userPortalProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 7 },
      create: { userId: 7, avatarStorageKey: 'new-key', avatarContentType: 'image/png', avatarStorageBackend: 'local' },
      update: { avatarStorageKey: 'new-key', avatarContentType: 'image/png', avatarStorageBackend: 'local' },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ newValue: { hasAvatar: true } }));
  });

  it('looks up public avatars only for opted-in profiles with complete metadata', async () => {
    db.userPortalProfile.findFirst.mockResolvedValue(null);
    await profiles.findPublicAvatar(7);
    expect(db.userPortalProfile.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 7,
        optedIn: true,
        avatarStorageKey: { not: null },
        avatarContentType: { not: null },
      },
    });
  });
});
