import Fastify from 'fastify';
import * as noteRepo from '../repositories/noteRepository';
import * as twoWaySync from '../services/twoWaySync';
import { ticketRoutes } from './tickets';

jest.mock('../repositories/noteRepository', () => ({
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
}));
jest.mock('../services/twoWaySync', () => ({
  pushNoteOut: jest.fn(),
}));

const mockedNoteRepo = jest.mocked(noteRepo);
const mockedTwoWaySync = jest.mocked(twoWaySync);

async function technicianApp() {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.user = {
      id: 2,
      username: 'technician',
      displayName: 'Technician',
      email: null,
      role: 'technician',
      authProvider: 'local',
      themePref: null,
      kanbanColumns: null,
    };
    request.actorSub = 'technician';
    request.authChannel = 'web';
  });
  await app.register(ticketRoutes);
  await app.ready();
  return app;
}

describe('POST /tickets/:id/notes public create contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedTwoWaySync.pushNoteOut.mockResolvedValue(undefined as never);
  });

  it.each([
    ['author', 'Forged Author'],
    ['authorId', 99],
    ['externalId', 'REMOTE-123'],
    ['direction', 'inbound'],
    ['emailFrom', 'attacker@example.com'],
    ['emailTo', 'customer@example.com'],
    ['emailCc', 'cc@example.com'],
    ['emailBcc', 'hidden@example.com'],
    ['subject', 'Forged subject'],
    ['inReplyTo', '<forged@example.com>'],
    ['messageId', '<forged-message@example.com>'],
    ['references', '<thread@example.com>'],
    ['timeStart', '2026-07-25T12:00:00.000Z'],
    ['timeStop', '2026-07-25T12:30:00.000Z'],
    ['minutes', 30],
  ])('rejects server-owned field %s before repository creation', async (field, value) => {
    const app = await technicianApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/tickets/42/notes',
        payload: { content: 'Local note', [field]: value },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain(field);
      expect(mockedNoteRepo.create).not.toHaveBeenCalled();
      expect(mockedTwoWaySync.pushNoteOut).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each(['email', 'time_entry'])('rejects the server-owned %s note type', async (noteType) => {
    const app = await technicianApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/tickets/42/notes',
        payload: { content: 'Wrong route', noteType },
      });

      expect(res.statusCode).toBe(400);
      expect(mockedNoteRepo.create).not.toHaveBeenCalled();
      expect(mockedTwoWaySync.pushNoteOut).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('constructs a local conversation note DTO, sanitizes HTML, and offers it for push-out', async () => {
    mockedNoteRepo.create.mockResolvedValue({
      id: 9,
      ticketId: 42,
      content: 'Customer called back',
      noteType: 'note',
    } as never);
    const app = await technicianApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/tickets/42/notes',
        payload: {
          content: '  Customer called back  ',
          htmlContent: '<p>Customer called back</p><script>steal()</script>',
          noteType: 'note',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(mockedNoteRepo.create).toHaveBeenCalledTimes(1);
      const [ticketId, input, actor] = mockedNoteRepo.create.mock.calls[0];
      expect(ticketId).toBe(42);
      expect(actor).toBe('technician');
      expect(input).toEqual({
        content: 'Customer called back',
        htmlContent: '<p>Customer called back</p>',
        noteType: 'note',
        author: 'Technician',
        authorId: 2,
        queueForTicketSync: true,
        visibility: 'public',
        via: 'web',
      });
      expect(input).not.toHaveProperty('externalId');
      expect(input).not.toHaveProperty('direction');
      expect(mockedTwoWaySync.pushNoteOut).toHaveBeenCalledWith(42, 9);
    } finally {
      await app.close();
    }
  });

  it('keeps internal notes local and never offers them to an external provider', async () => {
    mockedNoteRepo.create.mockResolvedValue({
      id: 10,
      ticketId: 42,
      content: 'Technician-only diagnostic',
      noteType: 'internal',
    } as never);
    const app = await technicianApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/tickets/42/notes',
        payload: {
          content: 'Technician-only diagnostic',
          noteType: 'internal',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(mockedNoteRepo.create).toHaveBeenCalledWith(
        42,
        expect.objectContaining({ noteType: 'internal' }),
        'technician'
      );
      expect(mockedTwoWaySync.pushNoteOut).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe('PATCH/DELETE /tickets/:id/notes/:noteId ownership and provenance', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['ticketId', 99],
    ['author', 'Forged Author'],
    ['authorId', 99],
    ['externalId', 'REMOTE-123'],
    ['direction', 'inbound'],
    ['noteType', 'internal'],
    ['emailFrom', 'attacker@example.com'],
    ['subject', 'Forged subject'],
  ])('PATCH rejects server-owned field %s', async (field, value) => {
    const app = await technicianApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/tickets/42/notes/9',
        payload: { content: 'Edited note', [field]: value },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain(field);
      expect(mockedNoteRepo.update).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('PATCH sanitizes and passes the parent ticket id to the repository', async () => {
    mockedNoteRepo.update.mockResolvedValue({ id: 9, ticketId: 42 } as never);
    const app = await technicianApp();
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/tickets/42/notes/9',
        payload: {
          content: '  Edited note  ',
          htmlContent: '<p>Edited note</p><script>steal()</script>',
          minutes: 15,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(mockedNoteRepo.update).toHaveBeenCalledWith(
        9,
        42,
        {
          content: 'Edited note',
          htmlContent: '<p>Edited note</p>',
          minutes: 15,
        },
        'technician'
      );
    } finally {
      await app.close();
    }
  });

  it('DELETE scopes the note lookup to the parent ticket id', async () => {
    mockedNoteRepo.remove.mockResolvedValue({ id: 9, ticketId: 42 } as never);
    const app = await technicianApp();
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: '/tickets/42/notes/9',
      });

      expect(res.statusCode).toBe(204);
      expect(mockedNoteRepo.remove).toHaveBeenCalledWith(9, 42, 'technician');
    } finally {
      await app.close();
    }
  });
});
