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
//   2.7.2      real 2.7 install          -> refused, nothing written
//   tampered   2.8.x + one rogue column  -> refused, nothing written
//   unknown    unrelated table only      -> refused, nothing written
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
       SELECT 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable
              || ' ' || coalesce(column_default, '') AS line
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

function expectRefused(label, db) {
  const before = snapshot(db);
  const { status, output } = applySchema(db);
  check(`${label}: refused (non-zero exit)`, status !== 0, `exit ${status}`);
  check(`${label}: refusal says why`, /Refusing to (adopt|guess)/.test(output));
  check(`${label}: no _prisma_migrations written`, !hasMigrationsTable(db));
  check(`${label}: schema untouched`, snapshot(db) === before);
}

const DB = {
  fresh: 'adk_verify_fresh',
  current: 'adk_verify_2_8',
  old: 'adk_verify_2_7_2',
  tampered: 'adk_verify_tampered',
  unknown: 'adk_verify_unknown',
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
  expectRefused('2.7.2', DB.old);

  loadFixture(DB.tampered, 'installed-2.8.x.schema.sql');
  psql(DB.tampered, 'ALTER TABLE tickets ADD COLUMN rogue_column text');
  expectRefused('tampered 2.8.x', DB.tampered);

  recreate(DB.unknown);
  psql(DB.unknown, 'CREATE TABLE something_else (id int)');
  expectRefused('unknown', DB.unknown);

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
