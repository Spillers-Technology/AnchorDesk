/**
 * Evidence file — DR-0003 / D-0027 / D-0034 (see corporate-strategy repo).
 *
 * AnchorDesk PR #33 ("Intake-scoped API tokens — create-only ceiling for
 * unattended agents") proposed a create-only token scope for unattended
 * agents (the AVR phone receptionist). Its `POST /tickets` dedup logic caught
 * a unique-constraint collision on `(externalId, externalProvider)` and
 * responded by *reading back and returning the pre-existing ticket* (200 +
 * full ticket body) so a create-only client could "dedupe without search
 * access". That is the defect: a credential scoped to create-only leaked read
 * access to arbitrary pre-existing ticket content through the collision path,
 * for any external identity value the caller could produce or guess. The
 * board closed #33 outright (D-0034 / DR-0003) rather than salvage a branch
 * 60+ commits behind `main`, on the condition that this collision-path
 * behavior be preserved as evidence before the branch's code disappeared.
 *
 * `main` currently has NO intake-credential endpoint at all (see
 * `backend/src/routes/tickets.ts`: `POST /tickets` has no external-identity
 * dedup branch, and `externalId`/`externalProvider` are deliberately excluded
 * from the public create field allowlist). So per DR-0003 step 1(a), this
 * file reproduces the exact vulnerable *pattern* — lifted from PR #33's own
 * diff — as a minimal, self-contained fixture wired against a fake
 * repository, and proves it discloses pre-existing ticket content. It is not
 * wired into any route and must never be imported from production code.
 *
 * The real, shipped fix (see `tickets.intakeScope.test.ts` and
 * `tickets.intakeCollision.test.ts`) does not use an externally-guessable
 * identity key at all. It structurally cannot hit this bug: idempotency is
 * keyed per-*credential* (`apiTokenId` + a caller-chosen opaque
 * `Idempotency-Key`, never a business identity like a phone number or email),
 * and a "collision" only ever replays that same credential's own prior
 * response — never another party's ticket. This file is kept as the
 * permanent record of why that design choice was made, not as a test of
 * shipped code.
 */
import { hasPrismaCode } from '../util/prismaErrors';

interface FakeTicket {
  id: number;
  title: string;
  description: string;
  companyName: string;
}

interface NaiveIntakeDeps {
  /** Mirrors ticketRepo.create — throws on a unique-constraint collision. */
  createTicket: (input: { title: string; externalId?: string; externalProvider?: string }) => Promise<FakeTicket>;
  /** Mirrors the findByExternal() helper PR #33 added to ticketRepository.ts. */
  findByExternal: (externalId: string, externalProvider: string) => Promise<FakeTicket | null>;
}

/**
 * Verbatim port of the vulnerable branch from PR #33's diff to
 * `backend/src/routes/tickets.ts` (POST /tickets), adapted only to remove the
 * Fastify request/reply plumbing:
 *
 *   if (hasPrismaCode(error, 'P2002') && body.externalId && body.externalProvider) {
 *     const existing = await ticketRepo.findByExternal(body.externalId, body.externalProvider);
 *     if (existing) return reply.status(200).send(existing);
 *   }
 *
 * DO NOT import this into src/ production code. It exists here only so the
 * defect it causes can be demonstrated and never silently reintroduced.
 */
async function naiveIntakeCreate(
  body: { title: string; externalId?: string; externalProvider?: string },
  deps: NaiveIntakeDeps,
): Promise<{ status: number; body: unknown }> {
  try {
    const ticket = await deps.createTicket(body);
    return { status: 201, body: ticket };
  } catch (error) {
    if (hasPrismaCode(error, 'P2002') && body.externalId && body.externalProvider) {
      const existing = await deps.findByExternal(body.externalId, body.externalProvider);
      if (existing) return { status: 200, body: existing };
    }
    throw error;
  }
}

function p2002(): unknown {
  // Shape hasPrismaCode() checks for (see util/prismaErrors.ts).
  return { code: 'P2002', clientVersion: 'test' };
}

describe('evidence: PR #33 create-only intake collision disclosed pre-existing ticket content', () => {
  it('returns an existing, unrelated ticket\'s content to a create-only caller who merely guessed its external identity', async () => {
    // A real, pre-existing ticket the intake credential must never be able to
    // read — created through some entirely different channel (a technician,
    // email-to-ticket, another integration; it does not matter which).
    const preExistingSensitiveTicket: FakeTicket = {
      id: 4821,
      title: 'Executive comp renegotiation — do not discuss with reception',
      description: 'Confidential HR matter. Caller: +1-555-0100.',
      companyName: 'Example Co',
    };

    const findByExternal = jest.fn().mockResolvedValue(preExistingSensitiveTicket);
    const createTicket = jest.fn().mockRejectedValue(p2002());

    // The create-only intake caller does not know ticket 4821 exists. It only
    // knows (or guesses, or coincidentally reuses) the external identity pair
    // that ticket happens to be keyed on — e.g. a caller phone number that was
    // also used as an externalId by an earlier, unrelated integration.
    const result = await naiveIntakeCreate(
      { title: 'New call about a printer', externalId: '+1-555-0100', externalProvider: 'avr' },
      { createTicket, findByExternal },
    );

    // THIS is the defect: a credential whose entire authorized capability is
    // "create a ticket" walked away with the full body of a pre-existing
    // ticket it has no read permission for, via nothing but a collision on a
    // caller-suppliable identity field. A 200 with hydrated content is
    // indistinguishable, to the token holder, from "here is the ticket you
    // just created" — the response shape does not even signal that a
    // pre-existing, unrelated record was disclosed instead of a fresh one.
    expect(result.status).toBe(200);
    expect(result.body).toBe(preExistingSensitiveTicket);
    expect((result.body as FakeTicket).title).toContain('Executive comp renegotiation');
    expect(findByExternal).toHaveBeenCalledWith('+1-555-0100', 'avr');
  });
});
