// The 2.7 release gate defaults the portal OFF. These suites exercise the
// portal working, so they run with it switched on; portalEnabled.test.ts owns
// the default-off behaviour.
jest.mock('../services/settingsService', () => ({
  isPortalEnabled: jest.fn().mockResolvedValue(true),
  getPortal: jest.fn().mockResolvedValue({ technicianIdentity: 'anonymous' }),
}));

jest.mock('../repositories/portalRepository', () => ({
  listTickets: jest.fn(),
  getTicket: jest.fn(),
  createTicket: jest.fn(),
  addComment: jest.fn(),
  ownsTicket: jest.fn(),
  createAttachments: jest.fn(),
  getVisibleAttachment: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  actorFor: (username: string, channel: string) => `${username} (${channel})`,
}));

jest.mock('../services/storage', () => ({
  buildKey: jest.fn(),
  currentStorage: jest.fn(),
  storageForBackend: jest.fn(),
}));

jest.mock('../services/twoWaySync', () => ({
  pushNoteOut: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../repositories/syncRunRepository', () => ({
  sanitizeSyncError: (value: string) => value,
}));

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import * as portalRepository from '../repositories/portalRepository';
import type { RequesterPrincipal } from '../types/principal';
import { portalRoutes } from './portal';
import * as twoWaySync from '../services/twoWaySync';
import { buildKey, currentStorage } from '../services/storage';

const requester: RequesterPrincipal = {
  kind: 'requester',
  contactId: 9,
  companyId: 7,
  name: 'Casey Customer',
  email: 'casey@example.test',
};

const mockedPortal = jest.mocked(portalRepository);
const pushNoteOut = twoWaySync.pushNoteOut as jest.Mock;
const mockedBuildKey = buildKey as jest.Mock;
const mockedCurrentStorage = currentStorage as jest.Mock;
const storage = {
  backend: 'local',
  put: jest.fn(),
  get: jest.fn(),
  delete: jest.fn(),
};

async function appWithPrincipal(principal: unknown = requester) {
  const app = Fastify();
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  });
  app.addHook('onRequest', async (request) => {
    request.principal = principal as never;
  });
  await app.register(portalRoutes);
  await app.ready();
  return app;
}

const ticketRow = {
  id: 42,
  ticketNumber: 'T-42',
  title: 'Printer offline',
  summary: 'Printer offline',
  description: null,
  status: 'Open',
  priority: 'Medium',
  source: 'portal',
  createdAt: new Date('2026-07-26T12:00:00.000Z'),
  updatedAt: new Date('2026-07-26T12:00:00.000Z'),
  closedAt: null,
  notes: [],
  attachments: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedCurrentStorage.mockResolvedValue(storage);
  mockedBuildKey.mockReturnValue('tickets/42/proof.txt');
  storage.put.mockResolvedValue(undefined);
  storage.delete.mockResolvedValue(undefined);
});

describe('portal requester route boundary', () => {
  it('positively rejects a staff principal before repository access', async () => {
    const app = await appWithPrincipal({
      kind: 'staff',
      user: { id: 2, username: 'technician' },
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/portal/tickets',
      });
      expect(response.statusCode).toBe(403);
      expect(mockedPortal.listTickets).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns the same 404 for a foreign or missing ticket', async () => {
    mockedPortal.getTicket.mockResolvedValue(null);
    const app = await appWithPrincipal();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/portal/tickets/42',
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Ticket not found' });
      expect(mockedPortal.getTicket).toHaveBeenCalledWith(requester, 42);
    } finally {
      await app.close();
    }
  });

  it('caps page size at 50 and returns the agreed list envelope', async () => {
    mockedPortal.listTickets.mockResolvedValue({
      items: [ticketRow],
      total: 1,
      page: 2,
      pageSize: 50,
    } as never);
    const app = await appWithPrincipal();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/portal/tickets?page=2&pageSize=500',
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers.pragma).toBe('no-cache');
      expect(mockedPortal.listTickets).toHaveBeenCalledWith(requester, {
        page: 2,
        pageSize: 50,
      });
      expect(response.json()).toMatchObject({
        total: 1,
        page: 2,
        pageSize: 50,
        items: [{ id: 42 }],
      });
      expect(response.json().items[0]).not.toHaveProperty('source');
    } finally {
      await app.close();
    }
  });

  it('rejects client ownership fields and derives the portal audit actor', async () => {
    const app = await appWithPrincipal();
    try {
      const forged = await app.inject({
        method: 'POST',
        url: '/portal/tickets',
        payload: {
          summary: 'Printer offline',
          companyId: 999,
        },
      });
      expect(forged.statusCode).toBe(400);
      expect(mockedPortal.createTicket).not.toHaveBeenCalled();

      mockedPortal.createTicket.mockResolvedValue(ticketRow as never);
      const valid = await app.inject({
        method: 'POST',
        url: '/portal/tickets',
        payload: {
          summary: '  Printer offline  ',
          description: '  Lobby printer  ',
        },
      });
      expect(valid.statusCode).toBe(201);
      expect(mockedPortal.createTicket).toHaveBeenCalledWith(
        requester,
        {
          summary: 'Printer offline',
          description: 'Lobby printer',
        },
        'requester:9 (portal)',
      );
    } finally {
      await app.close();
    }
  });

  it('returns a public portal note and does not expose its author identity', async () => {
    mockedPortal.addComment.mockResolvedValue({
      id: 5,
      content: 'Any update?',
      htmlContent: null,
      direction: null,
      noteType: 'note',
      visibility: 'public',
      via: 'portal',
      author: 'Casey Customer',
      authorId: null,
      createdAt: new Date('2026-07-26T13:00:00.000Z'),
    } as never);
    const app = await appWithPrincipal();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/portal/tickets/42/comments',
        payload: { content: '  Any update?  ' },
      });
      expect(response.statusCode).toBe(201);
      expect(mockedPortal.addComment).toHaveBeenCalledWith(
        requester,
        42,
        'Any update?',
        'requester:9 (portal)',
      );
      expect(pushNoteOut).toHaveBeenCalledWith(42, 5);
      expect(response.json()).toEqual({
        id: 5,
        content: 'Any update?',
        htmlContent: null,
        direction: null,
        createdAt: '2026-07-26T13:00:00.000Z',
        authorKind: 'you',
        authorName: null,
        authorAvatarUrl: null,
      });
    } finally {
      await app.close();
    }
  });

  it('stores a requester attachment and emits only the portal attachment allowlist', async () => {
    mockedPortal.ownsTicket.mockResolvedValue(true);
    mockedPortal.createAttachments.mockResolvedValue([{
      id: 17,
      ticketId: 42,
      filename: 'proof.txt',
      contentType: 'text/plain',
      size: 5,
      storageBackend: 'local',
      storageKey: 'tickets/42/proof.txt',
      createdBy: 'requester:9 (portal)',
      portalVisible: true,
      createdAt: new Date('2026-07-26T14:00:00.000Z'),
    }] as never);
    const boundary = 'anchordesk-portal-boundary';
    const payload = Buffer.from(
      `--${boundary}\r\n`
      + 'Content-Disposition: form-data; name="files"; filename="proof.txt"\r\n'
      + 'Content-Type: text/plain\r\n\r\n'
      + `hello\r\n--${boundary}--\r\n`,
    );
    const app = await appWithPrincipal();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/portal/tickets/42/attachments',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(201);
      expect(storage.put).toHaveBeenCalledWith(
        'tickets/42/proof.txt',
        Buffer.from('hello'),
        'text/plain',
      );
      expect(mockedPortal.createAttachments).toHaveBeenCalledWith(
        requester,
        42,
        [{
          filename: 'proof.txt',
          contentType: 'text/plain',
          size: 5,
          storageBackend: 'local',
          storageKey: 'tickets/42/proof.txt',
        }],
        'requester:9 (portal)',
      );
      expect(response.json()).toEqual([{
        id: 17,
        filename: 'proof.txt',
        contentType: 'text/plain',
        size: 5,
        createdAt: '2026-07-26T14:00:00.000Z',
        downloadUrl: '/api/portal/attachments/17/download',
      }]);
    } finally {
      await app.close();
    }
  });

  it('removes staged attachment bytes if ownership changes before metadata commit', async () => {
    mockedPortal.ownsTicket.mockResolvedValue(true);
    mockedPortal.createAttachments.mockResolvedValue(null);
    const boundary = 'anchordesk-portal-boundary';
    const payload = Buffer.from(
      `--${boundary}\r\n`
      + 'Content-Disposition: form-data; name="files"; filename="proof.txt"\r\n'
      + 'Content-Type: text/plain\r\n\r\n'
      + `hello\r\n--${boundary}--\r\n`,
    );
    const app = await appWithPrincipal();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/portal/tickets/42/attachments',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(404);
      expect(storage.delete).toHaveBeenCalledWith('tickets/42/proof.txt');
    } finally {
      await app.close();
    }
  });
});
