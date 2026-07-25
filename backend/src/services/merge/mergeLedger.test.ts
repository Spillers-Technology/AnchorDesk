import {
  MERGE_LEDGER_VERSION,
  MergeLedgerFormatError,
  parseMergeLedger,
} from './mergeLedger';

const valid = {
  version: MERGE_LEDGER_VERSION,
  noteIds: [1, 2],
  attachmentIds: [7],
  checklistItems: [{ id: 4, sortOrder: 2 }],
  childIds: [9],
  addedLabelIds: [3],
  addedDeviceIds: [],
  clearedSyncPendingNoteIds: [2],
  source: { status: 'In Progress', closedAt: null, syncState: 'pending', parentId: 5 },
};

describe('parseMergeLedger', () => {
  it('round-trips a well-formed ledger', () => {
    const parsed = parseMergeLedger(valid);
    expect(parsed.noteIds).toEqual([1, 2]);
    expect(parsed.checklistItems).toEqual([{ id: 4, sortOrder: 2 }]);
    expect(parsed.source.status).toBe('In Progress');
    expect(parsed.source.parentId).toBe(5);
  });

  it('treats a missing parentId as null rather than failing', () => {
    const { parentId: _drop, ...source } = valid.source;
    expect(parseMergeLedger({ ...valid, source }).source.parentId).toBeNull();
  });

  // The whole point of the ledger is that unmerge restores exactly what moved.
  // A ledger written by a newer version, or mangled by a direct database edit,
  // must stop the restore rather than replay the half of it that still parses.
  it('refuses an unknown version', () => {
    expect(() => parseMergeLedger({ ...valid, version: 99 })).toThrow(MergeLedgerFormatError);
  });

  it('refuses a non-integer id', () => {
    expect(() => parseMergeLedger({ ...valid, noteIds: [1, 'two'] })).toThrow(MergeLedgerFormatError);
  });

  it('refuses a checklist entry missing its sortOrder', () => {
    expect(() => parseMergeLedger({ ...valid, checklistItems: [{ id: 4 }] })).toThrow(
      MergeLedgerFormatError
    );
  });

  it('refuses a ledger with no source block', () => {
    const { source: _drop, ...rest } = valid;
    expect(() => parseMergeLedger(rest)).toThrow(MergeLedgerFormatError);
  });

  it.each([null, undefined, 'ledger', 42, []])('refuses %p', (input) => {
    expect(() => parseMergeLedger(input)).toThrow(MergeLedgerFormatError);
  });
});
