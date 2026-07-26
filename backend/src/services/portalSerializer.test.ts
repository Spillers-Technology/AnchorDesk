import {
  serializePortalAttachment,
  serializePortalNote,
  serializePortalTicket,
} from './portalSerializer';

const TICKET_KEYS = [
  'id',
  'ticketNumber',
  'title',
  'summary',
  'description',
  'status',
  'priority',
  'createdAt',
  'updatedAt',
  'closedAt',
  'notes',
  'attachments',
].sort();

const NOTE_KEYS = [
  'id',
  'content',
  'htmlContent',
  'direction',
  'createdAt',
  'authorKind',
].sort();

const ATTACHMENT_KEYS = [
  'id',
  'filename',
  'contentType',
  'size',
  'createdAt',
  'downloadUrl',
].sort();

describe('portal serialization security boundary', () => {
  it('emits only the exact requester allowlist and drops private activity', () => {
    const date = new Date('2026-07-26T12:00:00.000Z');
    const dto = serializePortalTicket({
      id: 42,
      ticketNumber: 'T-42',
      title: 'Cannot print',
      summary: 'Cannot print',
      description: 'Printer is offline',
      status: 'Open',
      priority: 'Medium',
      source: 'portal',
      createdAt: date,
      updatedAt: date,
      closedAt: null,

      // Existing sensitive fields and a canary for future model growth.
      companyId: 7,
      companyName: 'SECRET_COMPANY',
      contactId: 9,
      assigneeId: 2,
      assignee: { username: 'SECRET_ASSIGNEE' },
      teamId: 3,
      customFields: { private: 'SECRET_CUSTOM_FIELD' },
      externalId: 'SECRET_EXTERNAL_ID',
      externalProvider: 'jira',
      syncState: 'SECRET_SYNC_STATE',
      deviceLinks: [{ id: 1, hostname: 'SECRET_DEVICE' }],
      scriptJobs: [{ id: 2, output: 'SECRET_SCRIPT' }],
      auditHistory: [{ id: 3, newValue: 'SECRET_AUDIT' }],
      futureSecretField: 'SECRET_FUTURE_FIELD',

      notes: [
        {
          id: 1,
          content: 'Visible answer',
          htmlContent:
            '<p>Visible</p><img src="/api/attachments/11/download"><script>SECRET_SCRIPT_TAG</script>',
          noteType: 'note',
          visibility: 'public',
          via: 'web',
          direction: null,
          author: 'SECRET_NOTE_AUTHOR',
          authorId: 2,
          emailFrom: 'SECRET_FROM',
          createdAt: date,
        },
        {
          id: 2,
          content: 'SECRET_INTERNAL_NOTE',
          noteType: 'internal',
          visibility: 'internal',
          via: 'web',
          createdAt: date,
        },
        {
          id: 3,
          content: 'SECRET_EXPLICITLY_INTERNAL_EMAIL',
          noteType: 'email',
          visibility: 'internal',
          via: 'email',
          createdAt: date,
        },
        {
          id: 4,
          content: 'SECRET_PUBLIC_TIME_ENTRY',
          noteType: 'time_entry',
          visibility: 'public',
          via: 'sync',
          createdAt: date,
        },
      ],
      attachments: [
        {
          id: 11,
          filename: 'answer.txt',
          contentType: 'text/plain',
          size: 12,
          createdAt: date,
          portalVisible: true,
          storageBackend: 'SECRET_STORAGE_BACKEND',
          storageKey: 'SECRET_STORAGE_KEY',
          createdBy: 'SECRET_CREATED_BY',
        },
        {
          id: 12,
          filename: 'SECRET_INTERNAL_ATTACHMENT',
          contentType: 'text/plain',
          size: 99,
          createdAt: date,
          portalVisible: false,
          note: { noteType: 'internal' },
        },
        {
          id: 13,
          filename: 'SECRET_EXPLICITLY_PRIVATE_EMAIL_ATTACHMENT',
          contentType: 'text/plain',
          size: 100,
          createdAt: date,
          portalVisible: false,
          note: { noteType: 'email' },
        },
        {
          id: 14,
          filename: 'SECRET_FLAGGED_BUT_INTERNAL_ATTACHMENT',
          contentType: 'text/plain',
          size: 100,
          createdAt: date,
          portalVisible: true,
          noteId: 3,
          note: { noteType: 'email', visibility: 'internal' },
        },
      ],
    });

    expect(Object.keys(dto).sort()).toEqual(TICKET_KEYS);
    expect(dto.notes).toHaveLength(1);
    expect(Object.keys(dto.notes[0]).sort()).toEqual(NOTE_KEYS);
    expect(dto.attachments).toHaveLength(1);
    expect(Object.keys(dto.attachments[0]).sort()).toEqual(ATTACHMENT_KEYS);
    expect(dto.notes[0].htmlContent).toContain(
      '/api/portal/attachments/11/download',
    );
    expect(dto.notes[0].htmlContent).not.toContain('<script');

    const serialized = JSON.stringify(dto);
    for (const secret of [
      'SECRET_COMPANY',
      'SECRET_ASSIGNEE',
      'SECRET_CUSTOM_FIELD',
      'SECRET_EXTERNAL_ID',
      'SECRET_SYNC_STATE',
      'SECRET_DEVICE',
      'SECRET_SCRIPT',
      'SECRET_AUDIT',
      'SECRET_FUTURE_FIELD',
      'SECRET_NOTE_AUTHOR',
      'SECRET_FROM',
      'SECRET_STORAGE_BACKEND',
      'SECRET_STORAGE_KEY',
      'SECRET_CREATED_BY',
      'SECRET_INTERNAL_NOTE',
      'SECRET_INTERNAL_ATTACHMENT',
      'SECRET_EXPLICITLY_INTERNAL_EMAIL',
      'SECRET_EXPLICITLY_PRIVATE_EMAIL_ATTACHMENT',
      'SECRET_PUBLIC_TIME_ENTRY',
      'SECRET_FLAGGED_BUT_INTERNAL_ATTACHMENT',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('classifies requester and support authors without exposing identities', () => {
    const createdAt = new Date('2026-07-26T12:00:00.000Z');
    expect(serializePortalNote({
      id: 1,
      content: 'Mine',
      via: 'portal',
      visibility: 'public',
      createdAt,
    }).authorKind).toBe('you');
    expect(serializePortalNote({
      id: 2,
      content: 'Email reply',
      noteType: 'email',
      direction: 'inbound',
      createdAt,
    }).authorKind).toBe('you');
    expect(serializePortalNote({
      id: 3,
      content: 'Support reply',
      via: 'web',
      visibility: 'public',
      createdAt,
    }).authorKind).toBe('support');
    expect(serializePortalNote({
      id: 4,
      content: 'Provider reply',
      via: 'sync',
      visibility: 'public',
      noteType: 'note',
      createdAt,
    })).not.toHaveProperty('via');
  });

  it('uses an owned portal URL and never emits attachment storage coordinates', () => {
    const dto = serializePortalAttachment({
      id: 88,
      filename: 'report.pdf',
      contentType: 'application/pdf',
      size: 123,
      createdAt: new Date('2026-07-26T12:00:00.000Z'),
      storageBackend: 's3',
      storageKey: 'private/key',
    });
    expect(Object.keys(dto).sort()).toEqual(ATTACHMENT_KEYS);
    expect(dto.downloadUrl).toBe('/api/portal/attachments/88/download');
    expect(dto).not.toHaveProperty('storageBackend');
    expect(dto).not.toHaveProperty('storageKey');
  });
});
