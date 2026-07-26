jest.mock('../../db/prisma', () => ({
  prisma: {
    note: { findMany: jest.fn() },
  },
}));

jest.mock('../../repositories/ticketRepository', () => ({
  getById: jest.fn(),
}));

jest.mock('../../repositories/noteRepository', () => ({
  create: jest.fn(),
}));

jest.mock('../../repositories/mailboxRepository', () => ({
  enabled: jest.fn(),
}));

jest.mock('../../repositories/attachmentRepository', () => ({
  listByIds: jest.fn(),
  attachToNote: jest.fn(),
}));

jest.mock('../../repositories/mailIdentityRepository', () => ({
  getById: jest.fn(),
}));

jest.mock('../settingsService', () => ({
  getSmtp: jest.fn(),
}));

jest.mock('../storage', () => ({
  readToBuffer: jest.fn(),
}));

jest.mock('./SmtpMailTransport', () => ({
  mailTransport: { send: jest.fn() },
}));

import { prisma } from '../../db/prisma';
import * as ticketRepository from '../../repositories/ticketRepository';
import * as noteRepository from '../../repositories/noteRepository';
import * as mailboxRepository from '../../repositories/mailboxRepository';
import * as attachmentRepository from '../../repositories/attachmentRepository';
import { getSmtp } from '../settingsService';
import { readToBuffer } from '../storage';
import { mailTransport } from './SmtpMailTransport';
import { sendTicketEmail } from './ticketMail';

const ticketGet = ticketRepository.getById as jest.Mock;
const noteCreate = noteRepository.create as jest.Mock;
const mailboxesEnabled = mailboxRepository.enabled as jest.Mock;
const listByIds = attachmentRepository.listByIds as jest.Mock;
const attachToNote = attachmentRepository.attachToNote as jest.Mock;
const smtpSettings = getSmtp as jest.Mock;
const readBytes = readToBuffer as jest.Mock;
const send = mailTransport.send as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  ticketGet.mockResolvedValue({
    id: 42,
    ticketNumber: 'T-42',
    externalId: null,
    companyName: null,
  });
  (prisma.note.findMany as jest.Mock).mockResolvedValue([]);
  mailboxesEnabled.mockResolvedValue([]);
  smtpSettings.mockResolvedValue({ from: 'support@example.test' });
  noteCreate.mockResolvedValue({ id: 5 });
  send.mockResolvedValue({ messageId: '<sent@example.test>' });
});

describe('ticketMail inline image ownership', () => {
  it('loads inline IDs through the parent-ticket scope and leaves foreign IDs unresolved', async () => {
    listByIds.mockResolvedValue([
      {
        id: 99,
        filename: 'owned.png',
        contentType: 'image/png',
        storageBackend: 'local',
        storageKey: 'owned-key',
      },
    ]);
    readBytes.mockResolvedValue(Buffer.from('owned bytes'));

    await sendTicketEmail(42, {
      to: 'casey@example.test',
      subject: 'Update',
      author: 'Technician',
      actorSub: 'technician (api)',
      html: [
        '<p>Update</p>',
        '<img src="/api/attachments/99/download">',
        '<img src="/api/attachments/100/download">',
      ].join(''),
    });

    expect(listByIds).toHaveBeenCalledWith(42, [99, 100]);
    expect(readBytes).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message.html).toContain('cid:att99@anchordesk');
    expect(message.html).toContain('/api/attachments/100/download');
    expect(message.attachments).toEqual([
      expect.objectContaining({
        filename: 'owned.png',
        cid: 'att99@anchordesk',
      }),
    ]);
    expect(attachToNote).toHaveBeenCalledWith(
      [99],
      5,
      true,
      'technician (api)',
    );
  });
});
