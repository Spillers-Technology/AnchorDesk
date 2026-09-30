import { LocalSyncRow, planScope } from './syncScope';
import { ExternalTicket } from '../providers/TicketProvider';

const JOB = 7;
const joeOnly = { assigneeId: ['joe'], labels: { joe: 'Joe Tran', bob: 'Bob Smith' } };

const ext = (externalId: string, assignee: string | null): ExternalTicket => ({
  externalId,
  title: externalId,
  status: 'Open',
  assigneeIds: assignee ? [assignee] : [],
});

const local = (externalId: string, over: Partial<LocalSyncRow> = {}): LocalSyncRow => ({
  id: Number(externalId.replace(/\D/g, '')),
  externalId,
  syncJobId: JOB,
  syncScopePinned: false,
  syncState: 'synced',
  ...over,
});

function plan(fetched: ExternalTicket[], locals: LocalSyncRow[], soleJobForAccount = true) {
  return planScope({
    jobId: JOB,
    filter: joeOnly,
    fetched,
    locals: new Map(locals.map((l) => [l.externalId, l])),
    soleJobForAccount,
  });
}

describe('planScope', () => {
  it('imports new tickets that match and counts the rest as filtered', () => {
    const p = plan([ext('T-1', 'joe'), ext('T-2', 'bob')], []);
    expect(p.process.map((t) => t.externalId)).toEqual(['T-1']);
    expect(p.filtered).toBe(1);
    expect(p.detach).toEqual([]);
  });

  it('detaches an owned ticket that left the filter, with a reason in names', () => {
    const p = plan([ext('T-3', 'bob')], [local('T-3')]);
    expect(p.detach).toEqual([
      expect.objectContaining({ ticketId: 3, externalId: 'T-3', reason: "it's assigned to “Bob Smith”; this job only syncs Joe Tran" }),
    ]);
    // Leaving tickets are not in `process`: the service reconciles them once
    // more from `detach[].ext` and then stops syncing them.
    expect(p.process).toEqual([]);
  });

  it('keeps syncing a pinned ticket outside the filter', () => {
    const p = plan([ext('T-4', 'bob')], [local('T-4', { syncScopePinned: true })]);
    expect(p.process.map((t) => t.externalId)).toEqual(['T-4']);
    expect(p.detach).toEqual([]);
  });

  it('resumes a detached ticket that came back into scope', () => {
    const p = plan([ext('T-5', 'joe')], [local('T-5', { syncState: 'detached' })]);
    expect(p.resume).toEqual([5]);
    expect(p.process.map((t) => t.externalId)).toEqual(['T-5']);
  });

  it('leaves an already-detached ticket alone while it stays out of scope', () => {
    const p = plan([ext('T-6', 'bob')], [local('T-6', { syncState: 'detached' })]);
    expect(p.stillDetached).toBe(1);
    expect(p.detach).toEqual([]);
    expect(p.process).toEqual([]);
  });

  it("skips tickets another job owns, in or out of this job's filter", () => {
    const p = plan([ext('T-7', 'joe'), ext('T-8', 'bob')], [local('T-7', { syncJobId: 99 }), local('T-8', { syncJobId: 99 })]);
    expect(p.otherJob).toBe(2);
    expect(p.process).toEqual([]);
    expect(p.detach).toEqual([]);
  });

  it('adopts an ownerless ticket that matches', () => {
    const p = plan([ext('T-9', 'joe')], [local('T-9', { syncJobId: null })]);
    expect(p.adopt).toEqual([9]);
    expect(p.process.map((t) => t.externalId)).toEqual(['T-9']);
  });

  it("treats an ownerless ticket outside the filter as this job's when it's the only job on the account", () => {
    const p = plan([ext('T-10', 'bob')], [local('T-10', { syncJobId: null })], true);
    expect(p.adopt).toEqual([10]);
    expect(p.detach.map((d) => d.ticketId)).toEqual([10]);
  });

  it("won't guess the owner of an ownerless ticket when several jobs share the account", () => {
    const p = plan([ext('T-11', 'bob')], [local('T-11', { syncJobId: null })], false);
    expect(p.ambiguous).toEqual(['T-11']);
    expect(p.adopt).toEqual([]);
    expect(p.detach).toEqual([]);
  });

  it('with no filter, processes everything and detaches nothing', () => {
    const p = planScope({
      jobId: JOB,
      filter: null,
      fetched: [ext('T-12', 'bob'), ext('T-13', null)],
      locals: new Map([['T-12', local('T-12')]]),
      soleJobForAccount: true,
    });
    expect(p.process).toHaveLength(2);
    expect(p.detach).toEqual([]);
  });
});
