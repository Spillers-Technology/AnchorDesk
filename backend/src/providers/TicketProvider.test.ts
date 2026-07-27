import { localVisibilityForExternalNote } from './TicketProvider';

describe('external note requester audience', () => {
  it.each([
    ['explicit public comment', { noteType: 'note', visibility: 'public' }, 'public'],
    ['explicit internal comment', { noteType: 'note', visibility: 'internal' }, 'internal'],
    ['missing provider audience', { noteType: 'note' }, 'internal'],
    ['misclassified public time entry', { noteType: 'time_entry', visibility: 'public' }, 'internal'],
  ] as const)('maps %s fail-closed', (_label, note, expected) => {
    expect(localVisibilityForExternalNote(note)).toBe(expected);
  });
});
