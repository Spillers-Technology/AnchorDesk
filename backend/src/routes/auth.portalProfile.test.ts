jest.mock('../repositories/userPortalProfileRepository');
jest.mock('../services/storage', () => ({ currentStorage: jest.fn(), storageForBackend: jest.fn() }));
jest.mock('../services/settingsService', () => ({ getPortal: jest.fn() }));
// auth.ts owns several login flows; this suite mounts only the profile routes.
// Mock the ESM-only OIDC dependency path the same way focused route tests do.
jest.mock('../services/auth/oidcService', () => ({}));
jest.mock('../services/auth/samlService', () => ({}));

import { Readable } from 'stream';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import * as portalProfileRepo from '../repositories/userPortalProfileRepository';
import { currentStorage, storageForBackend } from '../services/storage';
import { getPortal } from '../services/settingsService';
import { authRoutes } from './auth';
import { portalProfileAvatarToken } from '../services/portalProfileAvatar';

const mockedProfiles = jest.mocked(portalProfileRepo);
const mockedStorage = currentStorage as jest.Mock;
const mockedStorageForBackend = storageForBackend as jest.Mock;
const mockedPortal = getPortal as jest.Mock;
const storage = { backend: 'local', put: jest.fn(), get: jest.fn(), delete: jest.fn() };
const profile = {
  userId: 12,
  displayName: 'Taylor',
  avatarStorageKey: 'portal-avatars/12/avatar.png',
  avatarContentType: 'image/png',
  publicEmail: 'taylor@example.test',
  publicPhone: '555-0100',
  optedIn: true,
};

async function app() {
  const server = Fastify();
  await server.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 10 } });
  server.addHook('onRequest', async (request) => {
    request.user = { id: 12, username: 'taylor' } as never;
    request.actorSub = 'taylor';
  });
  await server.register(authRoutes);
  await server.ready();
  return server;
}

describe('own portal profile routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStorage.mockResolvedValue(storage);
    mockedStorageForBackend.mockResolvedValue(storage);
    mockedPortal.mockResolvedValue({ technicianIdentity: 'named' });
    storage.put.mockResolvedValue(undefined);
    storage.delete.mockResolvedValue(undefined);
    storage.get.mockResolvedValue(Readable.from(Buffer.from('image')));
  });

  it('reads and saves only the authenticated technician profile', async () => {
    mockedProfiles.findForUser.mockResolvedValue(profile as never);
    mockedProfiles.updateForUser.mockResolvedValue(profile as never);
    const server = await app();
    try {
      const read = await server.inject({ method: 'GET', url: '/auth/portal-profile' });
      expect(read.statusCode).toBe(200);
      expect(read.json()).toMatchObject({ displayName: 'Taylor', optedIn: true });
      expect(read.json()).not.toHaveProperty('avatarStorageKey');
      expect(mockedProfiles.findForUser).toHaveBeenCalledWith(12);

      const saved = await server.inject({
        method: 'PUT',
        url: '/auth/portal-profile',
        payload: { displayName: ' Taylor ', publicEmail: 'public@example.test', publicPhone: '', optedIn: true },
      });
      expect(saved.statusCode).toBe(200);
      expect(mockedProfiles.updateForUser).toHaveBeenCalledWith(12, {
        displayName: 'Taylor', publicEmail: 'public@example.test', publicPhone: null, optedIn: true,
      }, 'taylor');
    } finally {
      await server.close();
    }
  });

  it('accepts one small raster image, stages it through AttachmentStorage, and stores no Attachment row', async () => {
    mockedProfiles.setAvatarForUser.mockResolvedValue({
      profile: { ...profile, avatarStorageKey: 'portal-avatars/12/new.png' },
      previousStorageKey: 'old-key',
      previousStorageBackend: 's3',
    } as never);
    const boundary = 'avatar-boundary';
    const server = await app();
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/auth/portal-profile/avatar',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="headshot.png"\r\nContent-Type: image/png\r\n\r\nimage\r\n--${boundary}--\r\n`),
      });
      expect(response.statusCode).toBe(201);
      expect(storage.put).toHaveBeenCalledWith(expect.stringMatching(/^portal-avatars\/12\//), Buffer.from('image'), 'image/png');
      expect(mockedProfiles.setAvatarForUser).toHaveBeenCalledWith(
        12,
        expect.objectContaining({ contentType: 'image/png', storageBackend: 'local' }),
        'taylor',
      );
      // Cleanup must target the backend the *previous* avatar actually lives
      // on (mocked as 's3' here), not whatever is current for new uploads.
      expect(mockedStorageForBackend).toHaveBeenCalledWith('s3');
      expect(storage.delete).toHaveBeenCalledWith('old-key');
      expect(response.json()).not.toHaveProperty('avatarStorageKey');
    } finally {
      await server.close();
    }
  });

  it('serves only signed, still-consented avatars while named identity is enabled', async () => {
    mockedProfiles.findPublicAvatar.mockResolvedValue(profile as never);
    const server = await app();
    const token = portalProfileAvatarToken(12, profile.avatarStorageKey);
    try {
      const response = await server.inject({ method: 'GET', url: `/portal-profile-avatar/${token}` });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/png');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toBe('image');

      mockedPortal.mockResolvedValue({ technicianIdentity: 'anonymous' });
      const disabled = await server.inject({ method: 'GET', url: `/portal-profile-avatar/${token}` });
      expect(disabled.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });
});
