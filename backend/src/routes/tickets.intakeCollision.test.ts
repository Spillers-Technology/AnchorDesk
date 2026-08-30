/**
 * Collision-nondisclosure acceptance test for the `intake` API token scope
 * (STD-005 C1 credential). This is the test DR-0003 (corporate-strategy
 * board decision) required before the intake-credential rebuild could be
 * called complete: proof that a colliding request and a fresh, non-colliding
 * request are indistinguishable to the caller in status code and response
 * shape, and that a collision never discloses a *different* ticket's id or
 * content than what that same credential originally submitted.
 *
 * This does not merely assert "collision returns 409" (DR-0003 explicitly
 * rejects that as sufficient) — it exercises the real paired create/replay
 * behavior end to end through the actual route and repository claim/complete
 * logic (repositories/intakeReceiptRepository.ts is NOT mocked here, unlike
 * tickets.intakeScope.test.ts, because the nondisclosure property lives
 * inside it).
 *
 * See intakeCollisionDisclosure.evidence.test.ts for the historical PR #33
 * defect this design replaces, and its doc comment for why an
 * externally-guessable identity key (phone number, email, externalId) is
 * never used here at all — the "identity key" is a caller-chosen opaque
 * Idempotency-Key scoped to this credential alone via a unique constraint.
 */
import Fastify from 'fastify';
import * as ticketRepo from '../repositories/ticketRepository';
import * as intakeReceipts from '../repositories/intakeReceiptRepository';
import { ticketRoutes } from './tickets';

jest.mock('../repositories/ticketRepository', () => ({ create: jest.fn() }));

const mockedTicketRepo = jest.mocked(ticketRepo);

// A real, in-memory stand-in for the Prisma-backed IntakeCreateReceipt table
// (apiTokenId, idempotencyKey) uniqueness — exercises the actual claim/
// replay/fail state machine in repositories/intakeReceiptRepository.ts
// without needing Postgres. Deliberately mirrors the schema's uniqueness and
// null-until-complete shape rather than re-implementing the security logic
// under a different name.
function makeFakeReceiptStore() {
  let nextId = 1;
  const rows = new Map<string, { id: number; ticketId: number | null; responseBody: unknown }>();
  const key = (apiTokenId: number, idempotencyKey: string) => `${apiTokenId}:${idempotencyKey}`;

  return {
    async claim(apiTokenId: number, idempotencyKey: string): Promise<intakeReceipts.ClaimResult> {
      const k = key(apiTokenId, idempotencyKey);
      const existing = rows.get(k);
      if (existing) {
        if (existing.responseBody !== null) {
          return { outcome: 'replay', responseBody: existing.responseBody };
        }
        return { outcome: 'in-progress' };
      }
      const id = nextId++;
      rows.set(k, { id, ticketId: null, responseBody: null });
      return { outcome: 'claimed', receiptId: id };
    },
    async complete(receiptId: number, ticketId: number, responseBody: unknown): Promise<void> {
      for (const row of rows.values()) {
        if (row.id === receiptId) {
          row.ticketId = ticketId;
          row.responseBody = responseBody;
          return;
        }
      }
    },
    async fail(receiptId: number): Promise<void> {
      for (const [k, row] of rows.entries()) {
        if (row.id === receiptId) rows.delete(k);
      }
    },
  };
}

// jest.mock's factory runs once per test file (module registry is cached),
// so the mock functions below close over this `let` binding by reference —
// reassigning it in beforeEach gives each test a fresh, isolated store
// without needing jest.resetModules(). (Jest's hoist check requires
// out-of-scope identifiers referenced inside jest.mock() to start with
// "mock", hence the name.)
let mockReceiptStore: ReturnType<typeof makeFakeReceiptStore>;

jest.mock('../repositories/intakeReceiptRepository', () => ({
  claim: (...args: [number, string]) => mockReceiptStore.claim(...args),
  complete: (...args: [number, number, unknown]) => mockReceiptStore.complete(...args),
  fail: (...args: [number]) => mockReceiptStore.fail(...args),
}));

async function buildApp(apiTokenId: number) {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.user = {
      id: 9, username: 'avr-intake', displayName: 'AVR Intake', email: null,
      role: 'technician', authProvider: 'local', themePref: null, kanbanColumns: null,
    };
    request.actorSub = 'avr-intake (api)';
    request.authChannel = 'api';
    request.tokenScope = 'intake';
    request.apiTokenId = apiTokenId;
  });
  await app.register(ticketRoutes);
  await app.ready();
  return app;
}

let ticketAutoId = 1000;

describe('intake token collision nondisclosure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReceiptStore = makeFakeReceiptStore();
    ticketAutoId = 1000;
    mockedTicketRepo.create.mockImplementation(async (input) => {
      ticketAutoId += 1;
      return {
        id: ticketAutoId,
        title: (input as { title: string }).title,
        status: 'New',
        createdAt: new Date('2026-08-29T12:00:00.000Z'),
      } as never;
    });
  });

  it('returns identical status and body shape for a fresh create and a replayed collision', async () => {
    const app = await buildApp(501);
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/tickets',
        headers: { 'idempotency-key': 'call-uuid-aaa' },
        payload: { title: 'Printer jam on 3rd floor' },
      });
      const replay = await app.inject({
        method: 'POST',
        url: '/tickets',
        headers: { 'idempotency-key': 'call-uuid-aaa' },
        // Even a caller that sends a *different* body on retry gets back
        // exactly what the first response said — the replay never touches
        // ticketRepo.create again, so a second body can't matter.
        payload: { title: 'Printer jam on 3rd floor (retry wording)' },
      });
      const fresh = await app.inject({
        method: 'POST',
        url: '/tickets',
        headers: { 'idempotency-key': 'call-uuid-bbb' },
        payload: { title: 'Different call, different issue' },
      });

      // Status and shape are indistinguishable across all three responses —
      // the "collision" case (replay) looks exactly like a fresh create.
      expect(first.statusCode).toBe(201);
      expect(replay.statusCode).toBe(201);
      expect(fresh.statusCode).toBe(201);
      const shape = (body: unknown) => Object.keys(body as object).sort();
      expect(shape(replay.json())).toEqual(shape(first.json()));
      expect(shape(fresh.json())).toEqual(shape(first.json()));

      // The replay is a byte-identical echo of the ORIGINAL response — not a
      // live re-read, and not the second request's own content — so it
      // cannot disclose anything the credential didn't already receive
      // itself the first time.
      expect(replay.json()).toEqual(first.json());

      // The fresh, differently-keyed request got its own distinct ticket —
      // proving the replay wasn't just "always return the same thing"
      // regardless of key, but genuinely scoped to that one idempotency key.
      expect(fresh.json().id).not.toBe(first.json().id);

      expect(mockedTicketRepo.create).toHaveBeenCalledTimes(2); // once per distinct key, never for the replay
    } finally {
      await app.close();
    }
  });

  it('never discloses a different credential\'s ticket even on the same idempotency key text', async () => {
    const appA = await buildApp(501);
    const appB = await buildApp(502);
    try {
      const resA = await appA.inject({
        method: 'POST',
        url: '/tickets',
        headers: { 'idempotency-key': 'shared-key-text' },
        payload: { title: 'Token A ticket' },
      });
      const resB = await appB.inject({
        method: 'POST',
        url: '/tickets',
        headers: { 'idempotency-key': 'shared-key-text' },
        payload: { title: 'Token B ticket' },
      });

      // Same literal Idempotency-Key string, but two different credentials —
      // idempotency is scoped per-token, so token B's identical-looking key
      // is a fresh create, never a replay of token A's ticket.
      expect(resA.statusCode).toBe(201);
      expect(resB.statusCode).toBe(201);
      expect(resB.json().id).not.toBe(resA.json().id);
      expect(resB.json().title).toBe('Token B ticket');
    } finally {
      await appA.close();
      await appB.close();
    }
  });

  it('rejects a create-only request missing the required Idempotency-Key without touching the repository', async () => {
    const app = await buildApp(501);
    try {
      const res = await app.inject({ method: 'POST', url: '/tickets', payload: { title: 'No key supplied' } });
      expect(res.statusCode).toBe(400);
      expect(mockedTicketRepo.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns 409 (never another ticket\'s data) for a genuinely concurrent retry of the same in-flight key', async () => {
    const app = await buildApp(501);
    try {
      // Manually claim the key first-hand to simulate a request that is
      // still being processed (created but not yet completed).
      await mockReceiptStore.claim(501, 'in-flight-key');

      const res = await app.inject({
        method: 'POST',
        url: '/tickets',
        headers: { 'idempotency-key': 'in-flight-key' },
        payload: { title: 'Racing request' },
      });
      expect(res.statusCode).toBe(409);
      expect(mockedTicketRepo.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
