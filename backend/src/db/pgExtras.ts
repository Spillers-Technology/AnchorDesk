/**
 * Postgres-specific schema extras that Prisma's schema can't express.
 *
 * We deliberately lean on Postgres features here (this app is PG-only since
 * 1.1.0): a GIN full-text index over tickets, and partial indexes that match
 * the hot list-query paths while skipping soft-deleted rows. All statements are
 * idempotent (IF NOT EXISTS) so this is safe to run on every boot.
 */
import { FastifyBaseLogger } from 'fastify';
import { prisma } from './prisma';

// to_tsvector expression used by both the index and the search query — they MUST
// match exactly for Postgres to use the index.
export const TICKET_TSV =
  "to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(description,'') || ' ' || coalesce(company_name,''))";

const STATEMENTS = [
  // Full-text search across ticket text + company.
  `CREATE INDEX IF NOT EXISTS idx_tickets_fts ON tickets USING GIN (${TICKET_TSV})`,
  // Common list filter: open tickets by company, excluding soft-deleted ones.
  `CREATE INDEX IF NOT EXISTS idx_tickets_active ON tickets (company_name, status, created_at DESC) WHERE status <> 'Deleted'`,
  // Device map / Network view groups by company; partial-skip orphans.
  `CREATE INDEX IF NOT EXISTS idx_devices_company_status ON devices (company_name, status) WHERE company_name IS NOT NULL`,
];

export async function ensurePgExtras(log: FastifyBaseLogger): Promise<void> {
  for (const sql of STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      log.warn({ err, sql }, 'Failed to ensure Postgres index');
    }
  }
  log.info('Postgres extras ensured (full-text + partial indexes)');
}
