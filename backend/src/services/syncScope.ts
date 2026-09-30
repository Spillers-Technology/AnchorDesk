/**
 * syncScope — which fetched tickets a sync job processes, and which ones stop
 * syncing because they left the job's filter. See docs/roadmap-sync-scope.md.
 *
 * Pure: the sync service looks up the local rows, calls `planScope`, and
 * applies the plan. Keeping the decision table here means every branch is
 * testable without a database, and the table is readable in one place:
 *
 * | local row            | in filter or pinned | outside filter                         |
 * |----------------------|---------------------|----------------------------------------|
 * | none                 | import (own it)     | filtered (never imported)              |
 * | owned by another job | skip — not ours     | skip — not ours                        |
 * | owned by this job    | process (resume if  | final reconcile, then detach           |
 * |                      | it was detached)    | (or stay detached)                     |
 * | no owner (legacy)    | adopt and process   | sole job for the account → as owned;   |
 * |                      |                     | otherwise leave it and say so          |
 *
 * "Final reconcile, then detach": the change that took a ticket out of scope is
 * applied locally before sync stops. With an open-tickets-only filter, a ticket
 * closed remotely must arrive closed; reassigned to someone else, it must show
 * who. Stopping first would freeze the local copy in its last in-scope state.
 */

import { ExternalTicket } from '../providers/TicketProvider';
import { explainMismatch, SyncFilter } from './syncFilter';

/** What the service needs to know about an existing local copy. */
export interface LocalSyncRow {
  id: number;
  externalId: string;
  syncJobId: number | null;
  syncScopePinned: boolean;
  syncState: string | null;
}

export interface ScopePlan {
  /** In scope: import, reconcile, or ingest as before. */
  process: ExternalTicket[];
  /** Local rows to stamp with this job as their owner before processing. */
  adopt: number[];
  /** Detached rows back in scope: resume them before processing. */
  resume: number[];
  /** Owned rows that left the filter this run: reconcile once more, then stop
   *  syncing them, with the reason. */
  detach: Array<{ ticketId: number; externalId: string; reason: string; ext: ExternalTicket }>;
  /** Fetched, never imported, and outside the filter. */
  filtered: number;
  /** Already detached and still outside the filter: nothing to do. */
  stillDetached: number;
  /** Owned by a different job whose scope overlaps this one. */
  otherJob: number;
  /** Pre-ownership rows outside the filter whose owner can't be proven. */
  ambiguous: string[];
}

export function planScope(input: {
  jobId: number;
  filter: SyncFilter | null;
  fetched: ExternalTicket[];
  locals: Map<string, LocalSyncRow>;
  /** True when this is the only job syncing from this provider account, so an
   *  ownerless row on the account can only have come from it. */
  soleJobForAccount: boolean;
}): ScopePlan {
  const plan: ScopePlan = {
    process: [],
    adopt: [],
    resume: [],
    detach: [],
    filtered: 0,
    stillDetached: 0,
    otherJob: 0,
    ambiguous: [],
  };

  for (const ext of input.fetched) {
    const local = input.locals.get(ext.externalId);
    const mismatch = explainMismatch(ext, input.filter);

    if (!local) {
      if (mismatch === null) plan.process.push(ext);
      else plan.filtered++;
      continue;
    }

    if (local.syncJobId != null && local.syncJobId !== input.jobId) {
      plan.otherJob++;
      continue;
    }

    const inScope = mismatch === null || local.syncScopePinned;
    const owned = local.syncJobId === input.jobId;

    if (inScope) {
      if (!owned) plan.adopt.push(local.id);
      if (local.syncState === 'detached') plan.resume.push(local.id);
      plan.process.push(ext);
      continue;
    }

    if (!owned && !input.soleJobForAccount) {
      plan.ambiguous.push(ext.externalId);
      continue;
    }
    if (local.syncState === 'detached') {
      plan.stillDetached++;
      continue;
    }
    if (!owned) plan.adopt.push(local.id);
    plan.detach.push({ ticketId: local.id, externalId: ext.externalId, reason: mismatch!, ext });
  }

  return plan;
}
