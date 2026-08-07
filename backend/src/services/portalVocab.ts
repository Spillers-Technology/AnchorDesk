/**
 * Backend source of truth for the small Portal v2 string vocabularies. These
 * remain varchar columns rather than Prisma enums so the stored values stay
 * easy to inspect and evolve, just like ticket status and priority.
 */
export const REGISTRATION_STATUSES = ['pending', 'approved', 'rejected'] as const;

const REGISTRATION_STATUS_BY_LOWER = new Map(
  REGISTRATION_STATUSES.map((status) => [status.toLowerCase(), status]),
);

/** Case-insensitive match to the canonical registration status. */
export function normalizeRegistrationStatus(value: string): string | null {
  return REGISTRATION_STATUS_BY_LOWER.get(value.trim().toLowerCase()) ?? null;
}
