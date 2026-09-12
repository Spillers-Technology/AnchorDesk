// Proves scripts/apply-schema.mjs against real PostgreSQL and real historical
// installs, not mocks. Each fixture under prisma/baseline/fixtures/ is a
// schema-only pg_dump of a database built by a published AnchorDesk image
// exactly as a deployment builds it (db push, then one boot so pgExtras and
// boot data migrations run) — see prisma/baseline/README.md.
//
// Cases:
//   fresh      empty database            -> migrate deploy, 0_init recorded
//   2.8.x      real 2.8 install + rows   -> adopted as 0_init; rows and schema unchanged
//   rerun      the adopted 2.8.x db      -> no-op, still exactly one 0_init row
//   2.7.2      real 2.7 install + rows   -> refused; rows and schema untouched
//   tampered   2.8.x + a rogue column    -> refused; rows and schema untouched
//   catalog    2.8.x + an extra CHECK, a dropped trigger, or an unrelated index
//              wearing an allowlisted name -> refused (Prisma's diff sees none of these)
//   enum-only  no tables but a stray enum -> refused (deploy would half-apply)
//   unknown    unrelated table only      -> refused, nothing written
//   interrupted history table without the baseline row -> re-verified, then finished;
//              the same state on a 2.7.2 database is refused
//   failed     a recorded failed migration -> refused, with the resolve command
//   equivalent fresh vs adopted 2.8.x    -> differ only by the pgExtras-owned indexes
//
// Usage: DATABASE_URL=<url of a database on a server where this role may
// CREATE DATABASE> node scripts/verify-baseline-upgrade.mjs
// Requires the `psql` client on PATH.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(backendRoot, 'prisma', 'baseline', 'fixtures');
const prismaCli = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js');
const adminUrl = process.env.DATABASE_URL?.trim();
if (!adminUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}

const PGEXTRAS_OWNED = [
  'idx_ticket_events_assignee_occurred',
  'idx_ticket_events_team_occurred',
];

function urlFor(db) {
  const url = new URL(adminUrl);
  url.pathname = `/${db}`;
  return url.toString();
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { cwd: backendRoot, encoding: 'utf8', ...opts });
  if (result.error) throw result.error;
  return result;
}

function psql(db, sql) {
  const r = run('psql', [urlFor(db), '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql]);
  if (r.status !== 0) throw new Error(`psql on ${db} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function recreate(db) {
  psql(new URL(adminUrl).pathname.slice(1), `DROP DATABASE IF EXISTS "${db}"`);
  psql(new URL(adminUrl).pathname.slice(1), `CREATE DATABASE "${db}"`);
}

function loadFixture(db, file) {
  recreate(db);
  const r = run('psql', [urlFor(db), '-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(fixtures, file)]);
  if (r.status !== 0) throw new Error(`loading ${file} failed: ${r.stderr}`);
}

function applySchema(db) {
  const r = run(process.execPath, ['scripts/apply-schema.mjs'], {
    env: { ...process.env, DATABASE_URL: urlFor(db) },
  });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

// Every table, column, index, constraint, trigger, and public function —
// enough to notice any object apply-schema might add, drop, or alter.
// _prisma_migrations is excluded: adding it is the one intended change.
function snapshot(db) {
  return psql(
    db,
    `SELECT string_agg(line, E'\\n' ORDER BY line) FROM (
       SELECT 'col ' || table_name || '.' || column_name || ' ' || data_type
              || '(' || coalesce(character_maximum_length::text, numeric_precision::text, '') || ')'
              || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS line
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
       UNION ALL
       SELECT 'idx ' || indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
       UNION ALL
       SELECT 'con ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
         FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text <> '_prisma_migrations'
       UNION ALL
       SELECT 'trg ' || pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal
       UNION ALL
       SELECT 'fn ' || proname || ' ' || md5(prosrc) FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
       UNION ALL
       SELECT 'ext ' || extname FROM pg_extension
       UNION ALL
       SELECT 'enum ' || t.typname || ' ' || e.enumlabel
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typnamespace = 'public'::regnamespace
       UNION ALL
       SELECT 'seq ' || sequencename || ' ' || coalesce(last_value::text, 'unused')
         FROM pg_sequences WHERE schemaname = 'public'
     ) objects`,
  );
}

function hasMigrationsTable(db) {
  return psql(db, `SELECT to_regclass('public._prisma_migrations') IS NOT NULL`) === 't';
}

function appliedBaselineRows(db) {
  return Number(
    psql(
      db,
      `SELECT count(*) FROM _prisma_migrations
        WHERE migration_name = '0_init' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    ),
  );
}

// Representative rows, including one in the append-only ticket_events table
// whose trigger rejects UPDATE/DELETE — adoption must not need to touch it.
const SEED = `
  INSERT INTO companies (name, updated_at) VALUES ('Acme Fixture Co', now());
  INSERT INTO tickets (title, company_id, updated_at)
    VALUES ('Baseline fixture: printer offline', (SELECT id FROM companies LIMIT 1), now());
  INSERT INTO notes (ticket_id, content, author, updated_at)
    VALUES ((SELECT id FROM tickets LIMIT 1), 'Internal note that must survive', 'fixture', now());
  INSERT INTO ticket_events (ticket_id, kind) VALUES ((SELECT id FROM tickets LIMIT 1), 'created');
`;
const SEED_OLD = `
  INSERT INTO companies (name, updated_at) VALUES ('Acme Fixture Co', now());
  INSERT INTO tickets (title, company_id, updated_at)
    VALUES ('Baseline fixture: printer offline', (SELECT id FROM companies LIMIT 1), now());
  INSERT INTO notes (ticket_id, content, author, updated_at)
    VALUES ((SELECT id FROM tickets LIMIT 1), 'Internal note that must survive', 'fixture', now());
`;
const DATA_FINGERPRINT = `
  SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
    SELECT 'c' || c::text AS t FROM companies c UNION ALL
    SELECT 't' || x::text FROM tickets x UNION ALL
    SELECT 'n' || n::text FROM notes n UNION ALL
    SELECT 'e' || e::text FROM ticket_events e UNION ALL
    SELECT 'u' || u::text FROM users u
  ) rows`;

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

function expectRefused(label, db, { seeded = false } = {}) {
  const before = snapshot(db);
  const dataBefore = seeded ? psql(db, DATA_FINGERPRINT) : null;
  const { status, output } = applySchema(db);
  check(`${label}: refused (non-zero exit)`, status !== 0, `exit ${status}`);
  check(`${label}: refusal says why`, /Refusing to (adopt|guess)/.test(output));
  check(`${label}: no _prisma_migrations written`, !hasMigrationsTable(db));
  check(`${label}: schema untouched`, snapshot(db) === before);
  if (seeded) {
    // A refusal that quietly destroyed rows would otherwise pass every check
    // above: empty fixtures cannot detect row loss.
    check(`${label}: rows untouched`, psql(db, DATA_FINGERPRINT) === dataBefore);
  }
}

const DB = {
  fresh: 'adk_verify_fresh',
  current: 'adk_verify_2_8',
  old: 'adk_verify_2_7_2',
  tampered: 'adk_verify_tampered',
  unknown: 'adk_verify_unknown',
  check: 'adk_verify_check',
  trigger: 'adk_verify_trigger',
  index: 'adk_verify_index',
  enumOnly: 'adk_verify_enum_only',
  interrupted: 'adk_verify_interrupted',
  interruptedBad: 'adk_verify_interrupted_bad',
  failed: 'adk_verify_failed',
};

try {
  // fresh
  recreate(DB.fresh);
  let r = applySchema(DB.fresh);
  check('fresh: migrate deploy succeeds', r.status === 0, `exit ${r.status}`);
  check('fresh: 0_init recorded once', appliedBaselineRows(DB.fresh) === 1);

  // 2.8.x with data
  loadFixture(DB.current, 'installed-2.8.x.schema.sql');
  psql(DB.current, SEED);
  const dataBefore = psql(DB.current, DATA_FINGERPRINT);
  const schemaBefore = snapshot(DB.current);
  r = applySchema(DB.current);
  check('2.8.x: adopted (exit 0)', r.status === 0, `exit ${r.status}`);
  check('2.8.x: fingerprint matched', /Schema matches AnchorDesk 2\.8\.x/.test(r.output));
  check('2.8.x: 0_init recorded once', appliedBaselineRows(DB.current) === 1);
  check('2.8.x: rows unchanged', psql(DB.current, DATA_FINGERPRINT) === dataBefore);
  check('2.8.x: schema unchanged apart from _prisma_migrations', snapshot(DB.current) === schemaBefore);

  // rerun
  r = applySchema(DB.current);
  check('rerun: no-op (exit 0)', r.status === 0, `exit ${r.status}`);
  check('rerun: still one 0_init row', appliedBaselineRows(DB.current) === 1);
  check('rerun: rows unchanged', psql(DB.current, DATA_FINGERPRINT) === dataBefore);

  // refusals
  loadFixture(DB.old, 'installed-2.7.2.schema.sql');
  psql(DB.old, SEED_OLD);
  expectRefused('2.7.2', DB.old, { seeded: true });

  loadFixture(DB.tampered, 'installed-2.8.x.schema.sql');
  psql(DB.tampered, SEED);
  psql(DB.tampered, 'ALTER TABLE tickets ADD COLUMN rogue_column text');
  expectRefused('tampered 2.8.x', DB.tampered, { seeded: true });

  // Objects Prisma's migrate diff cannot see. Each of these was adopted
  // silently before the catalog check existed.
  loadFixture(DB.check, 'installed-2.8.x.schema.sql');
  psql(DB.check, SEED);
  psql(DB.check, 'ALTER TABLE tickets ADD CONSTRAINT rogue CHECK (false) NOT VALID');
  expectRefused('extra CHECK constraint', DB.check, { seeded: true });

  loadFixture(DB.trigger, 'installed-2.8.x.schema.sql');
  psql(DB.trigger, SEED);
  psql(DB.trigger, 'DROP TRIGGER trg_ticket_events_append_only ON ticket_events');
  expectRefused('missing append-only trigger', DB.trigger, { seeded: true });

  loadFixture(DB.index, 'installed-2.8.x.schema.sql');
  psql(DB.index, SEED);
  psql(DB.index, 'DROP INDEX idx_ticket_events_team_occurred');
  psql(DB.index, 'CREATE UNIQUE INDEX idx_ticket_events_team_occurred ON users(username)');
  expectRefused('allowlisted index name, wrong index', DB.index, { seeded: true });

  // "No tables" is not "empty": migrate deploy would create migration history
  // and then fail on the pre-existing enum.
  recreate(DB.enumOnly);
  psql(DB.enumOnly, `CREATE TYPE "CustomFieldType" AS ENUM ('alien')`);
  expectRefused('enum-only database', DB.enumOnly);

  recreate(DB.unknown);
  psql(DB.unknown, 'CREATE TABLE something_else (id int)');
  expectRefused('unknown', DB.unknown);

  // Adoption interrupted after migrate resolve created the history table but
  // before it recorded the baseline: the next start must re-verify and finish,
  // not deploy 0_init over a populated database.
  loadFixture(DB.interrupted, 'installed-2.8.x.schema.sql');
  psql(DB.interrupted, SEED);
  const interruptedData = psql(DB.interrupted, DATA_FINGERPRINT);
  psql(
    DB.interrupted,
    `CREATE TABLE _prisma_migrations (id varchar(36) primary key, checksum varchar(64) not null,
      finished_at timestamptz, migration_name varchar(255) not null, logs text,
      rolled_back_at timestamptz, started_at timestamptz not null default now(),
      applied_steps_count integer not null default 0)`,
  );
  r = applySchema(DB.interrupted);
  check('interrupted adoption: recovers (exit 0)', r.status === 0, `exit ${r.status}`);
  check('interrupted adoption: 0_init recorded once', appliedBaselineRows(DB.interrupted) === 1);
  check('interrupted adoption: rows unchanged', psql(DB.interrupted, DATA_FINGERPRINT) === interruptedData);

  // Same interruption, but the schema is NOT 2.8 — recovery must refuse.
  loadFixture(DB.interruptedBad, 'installed-2.7.2.schema.sql');
  psql(
    DB.interruptedBad,
    `CREATE TABLE _prisma_migrations (id varchar(36) primary key, checksum varchar(64) not null,
      finished_at timestamptz, migration_name varchar(255) not null, logs text,
      rolled_back_at timestamptz, started_at timestamptz not null default now(),
      applied_steps_count integer not null default 0)`,
  );
  r = applySchema(DB.interruptedBad);
  check('interrupted adoption of a 2.7.2 database: refused', r.status !== 0, `exit ${r.status}`);
  check('interrupted adoption of a 2.7.2 database: no baseline row',
    appliedBaselineRows(DB.interruptedBad) === 0);

  // A failed migration must never be deployed over.
  loadFixture(DB.failed, 'installed-2.8.x.schema.sql');
  psql(
    DB.failed,
    `CREATE TABLE _prisma_migrations (id varchar(36) primary key, checksum varchar(64) not null,
      finished_at timestamptz, migration_name varchar(255) not null, logs text,
      rolled_back_at timestamptz, started_at timestamptz not null default now(),
      applied_steps_count integer not null default 0);
     INSERT INTO _prisma_migrations (id, checksum, migration_name, logs)
     VALUES ('x', 'y', '0_init', 'boom')`,
  );
  r = applySchema(DB.failed);
  check('failed migration: refused (exit non-zero)', r.status !== 0, `exit ${r.status}`);
  check('failed migration: says how to resolve it', /migrate resolve --rolled-back/.test(r.output));

  // equivalent: a fresh migration-built install and an adopted 2.8.x install
  // differ relationally only by the two indexes pgExtras creates at boot.
  const diff = run(process.execPath, [
    prismaCli, 'migrate', 'diff',
    '--from-url', urlFor(DB.fresh),
    '--to-url', urlFor(DB.current),
    '--script',
  ]);
  const statements = diff.stdout
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const onlyPgExtras = statements.every((s) =>
    PGEXTRAS_OWNED.some((name) => s.startsWith(`CREATE INDEX "${name}"`)),
  );
  check(
    'equivalent: fresh vs adopted 2.8.x differ only by pgExtras-owned indexes',
    diff.status === 0 && onlyPgExtras,
    statements.length ? statements.map((s) => s.slice(0, 80)).join(' | ') : 'identical',
  );
} catch (error) {
  failures.push('harness');
  console.error(error instanceof Error ? error.stack : String(error));
} finally {
  const adminDb = new URL(adminUrl).pathname.slice(1);
  for (const db of Object.values(DB)) {
    try {
      psql(adminDb, `DROP DATABASE IF EXISTS "${db}"`);
    } catch {
      // best effort
    }
  }
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nAll baseline upgrade checks passed.');
