/**
 * SLA engine. An SlaPolicy sets response + resolution targets (minutes) that
 * apply to a ticket matched by priority and/or company. When a ticket is scored
 * we pick the most specific matching policy:
 *
 *   company + priority  (specificity 3)
 *   company only        (specificity 2)
 *   priority only       (specificity 1)
 *   global default      (specificity 0 — both fields null)
 *
 * Deadlines are measured from ticket creation, so recomputing after a priority
 * change keeps the clock honest rather than resetting it.
 */
import { SlaPolicy } from '@prisma/client';
import { prisma } from '../db/prisma';

export interface SlaFields {
  slaPolicyId: number | null;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
}

/**
 * The deadline the resolution clock actually runs against: a manual dueAt
 * overrides the SLA target; clearing it falls back to the policy deadline.
 * The response clock is a separate promise and never consults dueAt.
 */
export function effectiveResolutionDueAt(ticket: {
  dueAt: Date | null;
  resolutionDueAt: Date | null;
}): Date | null {
  return ticket.dueAt ?? ticket.resolutionDueAt;
}

function matches(p: SlaPolicy, priority: string | null, companyId: number | null): boolean {
  if (p.companyId != null && p.companyId !== companyId) return false;
  if (p.priority != null && p.priority !== priority) return false;
  return true;
}

function specificity(p: SlaPolicy): number {
  return (p.companyId != null ? 2 : 0) + (p.priority != null ? 1 : 0);
}

/** Pure selection: the most specific matching policy from a candidate list, or
 *  null. Extracted so the precedence rule is unit-testable without a DB. */
export function pickPolicy(
  candidates: SlaPolicy[],
  priority: string | null | undefined,
  companyId: number | null | undefined,
): SlaPolicy | null {
  let best: SlaPolicy | null = null;
  for (const p of candidates) {
    if (!p.enabled) continue;
    if (!matches(p, priority ?? null, companyId ?? null)) continue;
    if (!best || specificity(p) > specificity(best)) best = p;
  }
  return best;
}

/** The most specific enabled policy that matches, or null when none applies. */
export async function resolvePolicy(
  priority: string | null | undefined,
  companyId: number | null | undefined,
): Promise<SlaPolicy | null> {
  const candidates = await prisma.slaPolicy.findMany({ where: { enabled: true } });
  return pickPolicy(candidates, priority, companyId);
}

/** Compute SLA deadline fields for a ticket, measured from `from` (its creation). */
export async function computeSlaFields(
  priority: string | null | undefined,
  companyId: number | null | undefined,
  from: Date,
): Promise<SlaFields> {
  const policy = await resolvePolicy(priority, companyId);
  if (!policy) return { slaPolicyId: null, responseDueAt: null, resolutionDueAt: null };
  return {
    slaPolicyId: policy.id,
    responseDueAt: new Date(from.getTime() + policy.responseMinutes * 60_000),
    resolutionDueAt: new Date(from.getTime() + policy.resolutionMinutes * 60_000),
  };
}
