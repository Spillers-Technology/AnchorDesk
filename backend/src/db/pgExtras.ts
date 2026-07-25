/**
 * Postgres-specific schema extras that Prisma's schema can't express.
 *
 * We deliberately lean on Postgres features here (this app is PG-only since
 * 1.1.0): a GIN full-text index over tickets, and partial indexes that match
 * the hot list-query paths while skipping soft-deleted rows.
 *
 * Most indexes are performance aids and remain best-effort. Three objects are
 * runtime correctness dependencies: pg_trgm provides `similarity()` used by
 * every ranked search, ticket_number_seq is called by every ticket create, and
 * the legacy external identity index closes PostgreSQL's nullable-unique gap.
 * Startup creates and validates all three before accepting traffic.
 */
import { FastifyBaseLogger } from 'fastify';
import { prisma } from './prisma';
import { config } from '../config/config';

// to_tsvector expression used by both the index and the search query — they MUST
// match exactly for Postgres to use the index.
export const TICKET_TSV =
  "to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(description,'') || ' ' || coalesce(company_name,''))";

// Concatenated, lower-cased ticket text used by trigram (typo-tolerant) search.
// Includes priority so "high"/"urgent" queries match. Must match the query.
export const TICKET_TRGM =
  "lower(coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(description,'') || ' ' || coalesce(company_name,'') || ' ' || coalesce(priority,'') || ' ' || coalesce(ticket_number,''))";

export const LEGACY_EXTERNAL_IDENTITY_INDEX_NAME =
  'idx_tickets_external_legacy_unique';
export const LEGACY_EXTERNAL_IDENTITY_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS ${LEGACY_EXTERNAL_IDENTITY_INDEX_NAME}
     ON tickets (external_id, external_provider)
     WHERE sync_connection_id IS NULL
       AND external_id IS NOT NULL
       AND external_provider IS NOT NULL`;
export const PG_TRGM_EXTENSION_SQL = 'CREATE EXTENSION IF NOT EXISTS pg_trgm';
export const TICKET_NUMBER_SEQUENCE_SQL =
  `CREATE SEQUENCE IF NOT EXISTS ticket_number_seq AS bigint ` +
  `START WITH ${10 ** (config.ticketNumberDigits - 1)} ` +
  `MINVALUE ${10 ** (config.ticketNumberDigits - 1)}`;

const EXPECTED_LEGACY_IDENTITY_PREDICATE =
  'sync_connection_idisnullandexternal_idisnotnullandexternal_providerisnotnull';

interface LegacyIdentityIndexMetadata {
  is_unique: boolean;
  is_valid: boolean;
  is_ready: boolean;
  access_method: string;
  key_columns: string[];
  predicate: string | null;
}

interface RuntimeDependencyMetadata {
  has_ticket_number_sequence: boolean;
  has_pg_trgm: boolean;
}

export class CriticalPgInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CriticalPgInvariantError';
  }
}

const OPTIONAL_STATEMENTS = [
  // Full-text search across ticket text + company.
  `CREATE INDEX IF NOT EXISTS idx_tickets_fts ON tickets USING GIN (${TICKET_TSV})`,
  // Trigram fuzzy-search indexes. The extension itself is a critical runtime
  // dependency and is created/validated before these best-effort indexes.
  `CREATE INDEX IF NOT EXISTS idx_tickets_trgm ON tickets USING GIN (${TICKET_TRGM} gin_trgm_ops)`,
  // Trigram over note bodies so search reaches into the conversation/timeline.
  `CREATE INDEX IF NOT EXISTS idx_notes_content_trgm ON notes USING GIN (lower(content) gin_trgm_ops)`,
  // Common list filter: open tickets by company, excluding soft-deleted ones.
  `CREATE INDEX IF NOT EXISTS idx_tickets_active ON tickets (company_name, status, created_at DESC) WHERE status <> 'Deleted'`,
  // Device map / Network view groups by company; partial-skip orphans.
  `CREATE INDEX IF NOT EXISTS idx_devices_company_status ON devices (company_name, status) WHERE company_name IS NOT NULL`,
];

function normalizePredicate(predicate: string | null): string {
  return (predicate ?? '').toLowerCase().replace(/["()\s]/g, '');
}

/**
 * Ensure functions/objects called unconditionally by normal product paths are
 * present. Treating either as an optional optimization would leave a listening
 * backend whose ticket creation or ranked search always fails.
 */
export async function ensureRuntimeDependencies(): Promise<void> {
  await prisma.$executeRawUnsafe(TICKET_NUMBER_SEQUENCE_SQL);
  await prisma.$executeRawUnsafe(PG_TRGM_EXTENSION_SQL);

  const rows = await prisma.$queryRawUnsafe<RuntimeDependencyMetadata[]>(`
    SELECT
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS object
        JOIN pg_catalog.pg_namespace AS schema_meta
          ON schema_meta.oid = object.relnamespace
        WHERE schema_meta.nspname = current_schema()
          AND object.relname = 'ticket_number_seq'
          AND object.relkind = 'S'
      ) AS has_ticket_number_sequence,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_extension
        WHERE extname = 'pg_trgm'
      ) AS has_pg_trgm
  `);
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row.has_ticket_number_sequence !== true ||
    row.has_pg_trgm !== true
  ) {
    throw new CriticalPgInvariantError(
      'Critical PostgreSQL runtime dependencies ticket_number_seq and pg_trgm are not both available',
    );
  }
}

/**
 * Ensure the database, not just application code, rejects duplicate identities
 * for legacy providers whose sync_connection_id is NULL.
 *
 * CREATE ... IF NOT EXISTS alone is insufficient: an unrelated or malformed
 * index with the same name makes Postgres skip creation. Querying the catalogs
 * after creation verifies the exact table, key order, uniqueness, readiness,
 * access method, and predicate before startup may continue.
 */
export async function ensureLegacyExternalIdentityInvariant(): Promise<void> {
  await prisma.$executeRawUnsafe(LEGACY_EXTERNAL_IDENTITY_INDEX_SQL);

  const rows = await prisma.$queryRawUnsafe<LegacyIdentityIndexMetadata[]>(`
    SELECT
      index_meta.indisunique AS is_unique,
      index_meta.indisvalid AS is_valid,
      index_meta.indisready AS is_ready,
      access_method.amname AS access_method,
      ARRAY(
        SELECT attribute.attname::text
        FROM unnest(index_meta.indkey::smallint[]) WITH ORDINALITY AS key_part(attnum, ordinal)
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = table_meta.oid
         AND attribute.attnum = key_part.attnum
        WHERE key_part.ordinal <= index_meta.indnkeyatts
        ORDER BY key_part.ordinal
      ) AS key_columns,
      pg_catalog.pg_get_expr(index_meta.indpred, index_meta.indrelid) AS predicate
    FROM pg_catalog.pg_index AS index_meta
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_meta.indexrelid
    JOIN pg_catalog.pg_class AS table_meta
      ON table_meta.oid = index_meta.indrelid
    JOIN pg_catalog.pg_namespace AS schema_meta
      ON schema_meta.oid = table_meta.relnamespace
    JOIN pg_catalog.pg_am AS access_method
      ON access_method.oid = index_class.relam
    WHERE schema_meta.nspname = current_schema()
      AND table_meta.relname = 'tickets'
      AND index_class.relname = '${LEGACY_EXTERNAL_IDENTITY_INDEX_NAME}'
  `);

  const row = rows[0];
  const valid =
    rows.length === 1 &&
    row.is_unique === true &&
    row.is_valid === true &&
    row.is_ready === true &&
    row.access_method === 'btree' &&
    Array.isArray(row.key_columns) &&
    row.key_columns.length === 2 &&
    row.key_columns[0] === 'external_id' &&
    row.key_columns[1] === 'external_provider' &&
    normalizePredicate(row.predicate) === EXPECTED_LEGACY_IDENTITY_PREDICATE;

  if (!valid) {
    throw new CriticalPgInvariantError(
      `Critical PostgreSQL invariant "${LEGACY_EXTERNAL_IDENTITY_INDEX_NAME}" is missing or has an unexpected definition`,
    );
  }
}

const TICKET_HIERARCHY_TRIGGER_NAME = 'trg_tickets_single_level_hierarchy';

/**
 * Enforce the 2.6 one-level hierarchy invariant in the database itself: a ticket
 * that has a parent may not also be a parent.
 *
 * `ticketRepository.setParent` already checks this under row locks, which
 * protects the application path. This protects everything else — the Prisma
 * Studio session, the direct `psql` fix at 2am, a future bulk import — which is
 * how relational invariants actually get broken. A depth-2 tree is not something
 * the reader, the UI, or the merge ledger knows how to represent, so it must not
 * be constructible at all.
 *
 * Written as a trigger rather than a CHECK constraint because the rule spans two
 * rows, which CHECK cannot see.
 */
export async function ensureTicketHierarchyInvariant(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION anchordesk_assert_single_level_hierarchy()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.parent_id IS NOT NULL THEN
        IF NEW.parent_id = NEW.id THEN
          RAISE EXCEPTION 'ticket % cannot be its own parent', NEW.id
            USING ERRCODE = 'check_violation';
        END IF;
        -- Lock the prospective parent before inspecting it. Without this the
        -- EXISTS checks below read a snapshot, and two concurrent transactions
        -- doing "A.parent := B" and "B.parent := A" each see the other's row as
        -- still parentless and both commit -- producing the depth-2 cycle this
        -- trigger exists to prevent. Each transaction already holds the row lock
        -- on the ticket it is updating, so taking the parent's lock here makes
        -- the pair either serialize or deadlock, and Postgres aborts one.
        PERFORM 1 FROM tickets WHERE id = NEW.parent_id FOR UPDATE;
        IF EXISTS (SELECT 1 FROM tickets WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
          RAISE EXCEPTION 'ticket % is already a child; AnchorDesk supports one level of hierarchy', NEW.parent_id
            USING ERRCODE = 'check_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM tickets WHERE parent_id = NEW.id) THEN
          RAISE EXCEPTION 'ticket % has children, so it cannot also become a child', NEW.id
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS ${TICKET_HIERARCHY_TRIGGER_NAME} ON tickets;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER ${TICKET_HIERARCHY_TRIGGER_NAME}
    BEFORE INSERT OR UPDATE OF parent_id ON tickets
    FOR EACH ROW EXECUTE FUNCTION anchordesk_assert_single_level_hierarchy();
  `);

  // Same reasoning as the legacy identity index: creation reporting success is
  // not proof the object exists with the definition we intended.
  const rows = await prisma.$queryRawUnsafe<Array<{ enabled: string }>>(`
    SELECT trigger_meta.tgenabled::text AS enabled
    FROM pg_catalog.pg_trigger AS trigger_meta
    JOIN pg_catalog.pg_class AS table_meta ON table_meta.oid = trigger_meta.tgrelid
    JOIN pg_catalog.pg_namespace AS schema_meta ON schema_meta.oid = table_meta.relnamespace
    WHERE schema_meta.nspname = current_schema()
      AND table_meta.relname = 'tickets'
      AND trigger_meta.tgname = '${TICKET_HIERARCHY_TRIGGER_NAME}'
      AND NOT trigger_meta.tgisinternal
  `);

  // Allowlist rather than a denylist of 'D': tgenabled is also 'R' (replica-only)
  // and 'A' (always). 'R' looks enabled in the catalog but does not fire for
  // ordinary origin writes, so treating anything-but-'D' as valid would accept a
  // trigger that enforces nothing on the path we care about.
  if (rows.length !== 1 || (rows[0].enabled !== 'O' && rows[0].enabled !== 'A')) {
    throw new CriticalPgInvariantError(
      `Critical PostgreSQL invariant "${TICKET_HIERARCHY_TRIGGER_NAME}" is missing or not ` +
        `enabled for origin writes (tgenabled=${rows[0]?.enabled ?? 'absent'})`,
    );
  }
}

const LIVE_MERGE_LEDGER_INDEX_NAME = 'ticket_merges_one_live_per_source';

/**
 * At most one un-reversed merge ledger per source ticket.
 *
 * `@@index([sourceId, unmergedAt])` in the schema is not unique and cannot be —
 * Prisma has no partial-unique syntax — so the guarantee has to be created here.
 * Without it, "a source is already merged" is enforced only by the application,
 * and a second live ledger would make unmerge silently pick the newest and strand
 * the other one's rows on the target forever.
 */
export async function ensureLiveMergeLedgerInvariant(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${LIVE_MERGE_LEDGER_INDEX_NAME}
      ON ticket_merges (source_id)
      WHERE unmerged_at IS NULL
  `);

  const rows = await prisma.$queryRawUnsafe<Array<{ is_unique: boolean; is_valid: boolean; predicate: string | null }>>(`
    SELECT index_meta.indisunique AS is_unique,
           index_meta.indisvalid AS is_valid,
           pg_catalog.pg_get_expr(index_meta.indpred, index_meta.indrelid) AS predicate
    FROM pg_catalog.pg_index AS index_meta
    JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_meta.indexrelid
    JOIN pg_catalog.pg_class AS table_meta ON table_meta.oid = index_meta.indrelid
    JOIN pg_catalog.pg_namespace AS schema_meta ON schema_meta.oid = table_meta.relnamespace
    WHERE schema_meta.nspname = current_schema()
      AND table_meta.relname = 'ticket_merges'
      AND index_class.relname = '${LIVE_MERGE_LEDGER_INDEX_NAME}'
  `);

  const row = rows[0];
  if (
    rows.length !== 1 ||
    row.is_unique !== true ||
    row.is_valid !== true ||
    // normalizePredicate lowercases and strips quotes, parens, and whitespace,
    // so the expected value is written in that already-normalized form.
    normalizePredicate(row.predicate) !== 'unmerged_atisnull'
  ) {
    throw new CriticalPgInvariantError(
      `Critical PostgreSQL invariant "${LIVE_MERGE_LEDGER_INDEX_NAME}" is missing or has an unexpected definition`,
    );
  }
}

export async function ensurePgExtras(log: FastifyBaseLogger): Promise<void> {
  // This is a correctness boundary, so any create/query/validation failure
  // propagates and aborts startup. Optional performance extras run only after it
  // has been proven.
  await ensureRuntimeDependencies();
  await ensureLegacyExternalIdentityInvariant();
  await ensureTicketHierarchyInvariant();
  await ensureLiveMergeLedgerInvariant();

  let optionalFailures = 0;
  for (const sql of OPTIONAL_STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (err) {
      optionalFailures++;
      log.warn({ err, sql }, 'Failed to ensure optional Postgres extra');
    }
  }
  log.info(
    { optionalFailures },
    optionalFailures > 0
      ? 'Critical Postgres invariants verified; some optional extras were unavailable'
      : 'Critical Postgres invariants and optional extras ensured',
  );
}
