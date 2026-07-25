/**
 * The undo inventory recorded by a merge, and its parser.
 *
 * Unmerge that re-derives "what probably came from #123" is a guess that gets
 * worse every day the surviving ticket keeps living — a note added to the target
 * an hour later is indistinguishable from one that moved. So a merge writes down
 * exactly which rows it touched, and unmerge replays precisely that list.
 *
 * Stored as JSON on `TicketMerge.undoPlan`, so the shape is versioned and
 * re-validated on read like `syncProviderRepository`'s stored config: a ledger
 * written by a future version, or corrupted by a direct database edit, must fail
 * closed rather than drive a partial restore that silently loses rows.
 */

/**
 * v2 added `sourceLabelIds` / `sourceDeviceIds`. v1 recorded only the ids the
 * merge *added* to the target, but the merge deletes every source association —
 * so a label the source and target both carried was dropped from the source and
 * never restored. Undoing a merge must not lose rows, and the only way to put
 * them back is to have written down what the source actually had. 2.6 has not
 * shipped, so a v1 ledger exists only in a development database; it fails
 * closed here rather than driving a lossy restore.
 */
export const MERGE_LEDGER_VERSION = 2 as const;

export interface MergeLedger {
  version: typeof MERGE_LEDGER_VERSION;
  /** Notes moved source → target. */
  noteIds: number[];
  /** Attachments moved source → target. */
  attachmentIds: number[];
  /** Checklist items moved source → target, with the sortOrder they had. */
  checklistItems: Array<{ id: number; sortOrder: number }>;
  /** Children reparented source → target. */
  childIds: number[];
  /** Labels the merge ADDED to the target (already-present ones are excluded,
   *  so unmerge cannot strip a label the target owned in its own right). */
  addedLabelIds: number[];
  /** Device links the merge added to the target, same exclusion rule. */
  addedDeviceIds: number[];
  /** Every label the SOURCE carried, including ones the target already had.
   *  `addedLabelIds` says what to remove from the target; this says what to put
   *  back on the source. They differ exactly on the overlap, which is the set v1
   *  silently destroyed. */
  sourceLabelIds: number[];
  /** Every device link the source carried, same distinction. */
  sourceDeviceIds: number[];
  /** Notes whose `syncPending` outbox flag the merge cleared because the target
   *  has no writable remote to drain them. Restored on unmerge. */
  clearedSyncPendingNoteIds: number[];
  /** The source's own state before the merge, for an exact restore. */
  source: {
    status: string;
    closedAt: string | null;
    /** SyncState is a Prisma enum; kept as its string form in JSON. */
    syncState: string | null;
    parentId: number | null;
  };
}

export class MergeLedgerFormatError extends Error {
  constructor(detail: string) {
    super(`merge ledger is unreadable (${detail}); refusing to unmerge`);
    this.name = 'MergeLedgerFormatError';
  }
}

function intArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) throw new MergeLedgerFormatError(`${field} is not an array`);
  return value.map((entry) => {
    if (!Number.isInteger(entry)) throw new MergeLedgerFormatError(`${field} holds a non-integer`);
    return entry as number;
  });
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new MergeLedgerFormatError(`${field} is not a string`);
  return value;
}

/**
 * Re-validate a stored ledger. Never trusts the JSON: an unknown version, a
 * missing key, or a wrong type throws rather than restoring part of a merge.
 */
export function parseMergeLedger(raw: unknown): MergeLedger {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new MergeLedgerFormatError('not an object');
  }
  const plan = raw as Record<string, unknown>;
  if (plan.version !== MERGE_LEDGER_VERSION) {
    throw new MergeLedgerFormatError(`unsupported version ${String(plan.version)}`);
  }

  const rawSource = plan.source;
  if (!rawSource || typeof rawSource !== 'object' || Array.isArray(rawSource)) {
    throw new MergeLedgerFormatError('source is not an object');
  }
  const source = rawSource as Record<string, unknown>;
  if (typeof source.status !== 'string') {
    throw new MergeLedgerFormatError('source.status is not a string');
  }
  const parentId = source.parentId;
  if (parentId !== null && parentId !== undefined && !Number.isInteger(parentId)) {
    throw new MergeLedgerFormatError('source.parentId is not an integer or null');
  }

  const checklistRaw = plan.checklistItems;
  if (!Array.isArray(checklistRaw)) throw new MergeLedgerFormatError('checklistItems is not an array');
  const checklistItems = checklistRaw.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new MergeLedgerFormatError('checklistItems holds a non-object');
    }
    const item = entry as Record<string, unknown>;
    if (!Number.isInteger(item.id) || !Number.isInteger(item.sortOrder)) {
      throw new MergeLedgerFormatError('checklistItems entry is missing id/sortOrder');
    }
    return { id: item.id as number, sortOrder: item.sortOrder as number };
  });

  return {
    version: MERGE_LEDGER_VERSION,
    noteIds: intArray(plan.noteIds, 'noteIds'),
    attachmentIds: intArray(plan.attachmentIds, 'attachmentIds'),
    checklistItems,
    childIds: intArray(plan.childIds, 'childIds'),
    addedLabelIds: intArray(plan.addedLabelIds, 'addedLabelIds'),
    addedDeviceIds: intArray(plan.addedDeviceIds, 'addedDeviceIds'),
    sourceLabelIds: intArray(plan.sourceLabelIds, 'sourceLabelIds'),
    sourceDeviceIds: intArray(plan.sourceDeviceIds, 'sourceDeviceIds'),
    clearedSyncPendingNoteIds: intArray(
      plan.clearedSyncPendingNoteIds,
      'clearedSyncPendingNoteIds'
    ),
    source: {
      status: source.status,
      closedAt: nullableString(source.closedAt, 'source.closedAt'),
      syncState: nullableString(source.syncState, 'source.syncState'),
      parentId: (parentId as number | null | undefined) ?? null,
    },
  };
}
