import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error('DATABASE_URL is required to apply the Prisma schema.');
  process.exit(2);
}

const prismaCli = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js');
const childEnv = { ...process.env, DATABASE_URL: databaseUrl };
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

function runPrisma(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: backendRoot,
    env: childEnv,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

// ---------------------------------------------------------------------------
// Adopting an existing `db push` database means telling Prisma that 0_init is
// already applied. That is only true for the 2.8.x line: 0_init is the 2.8
// datamodel verbatim (CI proves it against prisma/baseline/schema-2.8.prisma),
// and every 2.8.x release installs a byte-identical schema.
//
// Two independent checks have to agree before we record the baseline, because
// neither is sufficient alone:
//
//   1. `prisma migrate diff` against the frozen 2.8 datamodel — catches tables,
//      columns, types, defaults, enums, FKs, and Prisma-declared indexes.
//   2. A catalog check of the objects Prisma's diff cannot see at all — CHECK
//      constraints, triggers, and the exact definition of the two extra B-tree
//      indexes pgExtras.ts creates. Without this, a database carrying an extra
//      CHECK constraint, a missing append-only trigger, or an unrelated UNIQUE
//      index wearing an allowlisted name is adopted as if it were stock 2.8.
// ---------------------------------------------------------------------------
const BASELINE_DATAMODEL = path.join(backendRoot, 'prisma', 'baseline', 'schema-2.8.prisma');

// Created by pgExtras.ts beyond schema.prisma, so Prisma's diff proposes
// dropping them. Optional extras: absent is fine, but present must mean *this*
// index — same table, columns, method, and non-unique.
const PGEXTRAS_INDEXES = {
  idx_ticket_events_assignee_occurred:
    'ON {schema}.ticket_events USING btree (assignee_id, occurred_at)',
  idx_ticket_events_team_occurred:
    'ON {schema}.ticket_events USING btree (team_id, occurred_at)',
};
const ALLOWED_DROP_INDEX = new Set(
  Object.keys(PGEXTRAS_INDEXES).map((name) => `DROP INDEX "${name}"`),
);
// Invariants pgExtras.ts asserts on every 2.8 boot. Prisma models none of them.
const EXPECTED_CHECK_CONSTRAINTS = new Set(['sessions_scope_principal_check']);
const EXPECTED_TRIGGERS = new Set([
  'trg_ticket_events_append_only on ticket_events',
  'trg_ticket_sla_snapshots_append_only on ticket_sla_snapshots',
  'trg_tickets_single_level_hierarchy on tickets',
]);

function diffStatements(script) {
  return script
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function unexpectedBaselineDrift() {
  const result = spawnSync(
    process.execPath,
    [
      prismaCli,
      'migrate',
      'diff',
      '--from-url',
      databaseUrl,
      '--to-schema-datamodel',
      BASELINE_DATAMODEL,
      '--script',
    ],
    { cwd: backendRoot, env: childEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Could not fingerprint the existing schema (prisma migrate diff exited ${result.status}): ` +
        (result.stderr || '').trim(),
    );
  }
  return diffStatements(result.stdout).filter((statement) => !ALLOWED_DROP_INDEX.has(statement));
}

/** Objects Prisma's diff is blind to. Returns a list of human-readable problems. */
async function catalogProblems(schemaName) {
  const problems = [];
  const schema = quoteIdentifier(schemaName);

  const indexRows = await prisma.$queryRawUnsafe(
    `SELECT indexname::text AS name, indexdef::text AS def
       FROM pg_indexes
      WHERE schemaname = $1 AND indexname = ANY($2::text[])`,
    schemaName,
    Object.keys(PGEXTRAS_INDEXES),
  );
  for (const row of indexRows) {
    const expected = `CREATE INDEX ${row.name} ${PGEXTRAS_INDEXES[row.name].replace('{schema}', schemaName)}`;
    if (row.def !== expected) {
      problems.push(`index ${row.name} is not the index AnchorDesk creates: ${row.def}`);
    }
  }

  const checkRows = await prisma.$queryRawUnsafe(
    `SELECT conname::text AS name
       FROM pg_constraint
      WHERE connamespace = $1::regnamespace AND contype = 'c'`,
    schema,
  );
  const checks = new Set(checkRows.map((r) => r.name));
  for (const name of EXPECTED_CHECK_CONSTRAINTS) {
    if (!checks.has(name)) problems.push(`missing CHECK constraint ${name}`);
  }
  for (const name of checks) {
    if (!EXPECTED_CHECK_CONSTRAINTS.has(name)) problems.push(`unexpected CHECK constraint ${name}`);
  }

  const triggerRows = await prisma.$queryRawUnsafe(
    `SELECT (t.tgname || ' on ' || c.relname)::text AS name
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.relnamespace = $1::regnamespace`,
    schema,
  );
  const triggers = new Set(triggerRows.map((r) => r.name));
  for (const name of EXPECTED_TRIGGERS) {
    if (!triggers.has(name)) problems.push(`missing trigger ${name}`);
  }
  for (const name of triggers) {
    if (!EXPECTED_TRIGGERS.has(name)) problems.push(`unexpected trigger ${name}`);
  }

  return problems;
}

function refuse(schemaName, headline, details) {
  console.error(`Refusing to adopt schema "${schemaName}": ${headline} Nothing was changed.`);
  for (const detail of details.slice(0, 10)) {
    console.error(`  ${detail.length > 200 ? `${detail.slice(0, 200)}…` : detail}`);
  }
  console.error(
    'Only an unmodified AnchorDesk 2.8.x install can be upgraded to versioned migrations in ' +
      'place. Upgrade to 2.8.2 first with the 2.8.2 image, confirm it starts (which restores the ' +
      'objects AnchorDesk creates at boot), then upgrade again.',
  );
}

/** True when this database is stock 2.8.x and safe to record 0_init against. */
async function isAdoptableBaseline(schemaName) {
  if (schemaName !== 'public') {
    refuse(schemaName, `adoption is only supported in the "public" schema.`, [
      `this database's current_schema() is "${schemaName}"`,
    ]);
    return false;
  }
  const unexpected = unexpectedBaselineDrift();
  if (unexpected.length > 0) {
    refuse(
      schemaName,
      `its relational schema differs from AnchorDesk 2.8.x (${unexpected.length} difference(s)).`,
      unexpected,
    );
    return false;
  }
  const problems = await catalogProblems(schemaName);
  if (problems.length > 0) {
    refuse(
      schemaName,
      `its constraints, triggers, or indexes are not AnchorDesk 2.8.x's (${problems.length} problem(s)).`,
      problems,
    );
    return false;
  }
  return true;
}

let exitCode = 1;
try {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      current_schema()::text AS "schemaName",
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = '_prisma_migrations' AND table_type = 'BASE TABLE'
      ) AS "hasMigrationsTable",
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'tickets' AND table_type = 'BASE TABLE'
      ) AS "hasSentinel",
      (
        SELECT count(*)::int FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name <> '_prisma_migrations' AND table_type = 'BASE TABLE'
      ) AS "otherTableCount",
      -- "No tables" is not "empty": a stray enum, sequence, or view makes
      -- "migrate deploy" create migration history and then fail partway.
      (
        SELECT count(*)::int FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = current_schema() AND t.typtype = 'e'
      ) AS "enumCount",
      (
        SELECT count(*)::int FROM pg_class
        WHERE relnamespace = current_schema()::regnamespace AND relkind IN ('S', 'v', 'm')
      ) AS "otherObjectCount"
  `);
  const state = rows[0];
  if (rows.length !== 1 || !state?.schemaName) {
    throw new Error('Could not resolve the current PostgreSQL schema.');
  }
  const schema = quoteIdentifier(state.schemaName);

  let baselineApplied = false;
  let incomplete = [];
  if (state.hasMigrationsTable) {
    const migrationRows = await prisma.$queryRawUnsafe(`
      SELECT migration_name::text AS name,
             (finished_at IS NOT NULL AND rolled_back_at IS NULL) AS "applied",
             (finished_at IS NULL AND rolled_back_at IS NULL AND logs IS NOT NULL) AS "failed"
        FROM ${schema}."_prisma_migrations"
    `);
    baselineApplied = migrationRows.some((r) => r.name === '0_init' && r.applied);
    incomplete = migrationRows.filter((r) => !r.applied);
  }

  const isEmpty =
    state.otherTableCount === 0 && state.enumCount === 0 && state.otherObjectCount === 0;

  let shouldDeploy = false;
  let shouldAdopt = false;

  if (state.hasMigrationsTable && baselineApplied) {
    console.log(
      `Schema "${state.schemaName}" already has the 0_init baseline; running prisma migrate deploy.`,
    );
    shouldDeploy = true;
  } else if (state.hasMigrationsTable && incomplete.some((r) => r.failed)) {
    // Prisma refuses to deploy over a failed migration, and guessing which half
    // of it landed is exactly the judgement a script should not make.
    console.error(
      `Schema "${state.schemaName}" has a failed migration recorded ` +
        `(${incomplete.filter((r) => r.failed).map((r) => r.name).join(', ')}). ` +
        'Resolve it by hand — restore the pre-upgrade backup, or use ' +
        '`prisma migrate resolve --rolled-back <name>` once you know the database is consistent. ' +
        'Nothing was changed.',
    );
    exitCode = 1;
  } else if (state.hasMigrationsTable && !baselineApplied && state.hasSentinel) {
    // An adoption that was interrupted after `migrate resolve` created the
    // history table but before it recorded the baseline. Re-verify, then finish.
    console.log(
      `Schema "${state.schemaName}" has migration history without the 0_init baseline and has ` +
        'application tables; re-checking it against AnchorDesk 2.8.x before finishing adoption.',
    );
    shouldAdopt = true;
  } else if (state.hasMigrationsTable && !baselineApplied && incomplete.length > 0) {
    console.log(
      `Schema "${state.schemaName}" has a migration in flight from another process; ` +
        'leaving it alone and exiting non-zero so this start is retried.',
    );
    exitCode = 1;
  } else if (isEmpty) {
    console.log(
      `Schema "${state.schemaName}" is empty; running prisma migrate deploy for a fresh install.`,
    );
    shouldDeploy = true;
  } else if (state.hasSentinel) {
    console.log(
      `Schema "${state.schemaName}" has tickets but no _prisma_migrations; ` +
        'checking it matches the AnchorDesk 2.8.x schema before adopting it as the 0_init baseline.',
    );
    shouldAdopt = true;
  } else {
    console.error(
      `Schema "${state.schemaName}" holds objects AnchorDesk did not put there ` +
        `(${state.otherTableCount} table(s), ${state.enumCount} enum(s), ` +
        `${state.otherObjectCount} sequence/view(s)), but has neither the 0_init baseline nor a ` +
        'tickets table. Refusing to guess its state; inspect the database manually. ' +
        'Nothing was changed.',
    );
    exitCode = 1;
  }

  if (shouldAdopt) {
    if (await isAdoptableBaseline(state.schemaName)) {
      console.log('Schema matches AnchorDesk 2.8.x; marking 0_init as applied.');
      const resolveStatus = runPrisma(['migrate', 'resolve', '--applied', '0_init']);
      if (resolveStatus === 0) {
        shouldDeploy = true;
      } else {
        // Do not replace this tolerance check with an advisory lock held while the
        // CLI runs. PrismaClient pools connections, so connection-affine locking
        // and unlocking across the subprocess boundary would not be reliable.
        let baselineWasApplied = false;
        try {
          const appliedRows = await prisma.$queryRawUnsafe(`
            SELECT EXISTS (
              SELECT 1 FROM ${schema}."_prisma_migrations"
              WHERE migration_name = '0_init' AND finished_at IS NOT NULL
            ) AS "isApplied"
          `);
          baselineWasApplied = appliedRows[0]?.isApplied === true;
        } catch (error) {
          console.error(
            'Could not verify whether another process applied 0_init: ' +
              (error instanceof Error ? error.message : String(error)),
          );
          baselineWasApplied = false;
        }

        if (baselineWasApplied) {
          console.log(
            'Another process finished applying the 0_init baseline; ' +
              'continuing with prisma migrate deploy.',
          );
          shouldDeploy = true;
        } else {
          console.error(`prisma migrate resolve failed with exit code ${resolveStatus}`);
          exitCode = resolveStatus;
        }
      }
    } else {
      exitCode = 1;
    }
  }

  if (shouldDeploy) {
    const deployStatus = runPrisma(['migrate', 'deploy']);
    if (deployStatus !== 0) {
      console.error(`prisma migrate deploy failed with exit code ${deployStatus}`);
    }
    exitCode = deployStatus;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  try {
    await prisma.$disconnect();
  } catch (error) {
    console.error(
      'Failed to disconnect the schema inspection client: ' +
        (error instanceof Error ? error.message : String(error)),
    );
    if (exitCode === 0) exitCode = 1;
  }
}

process.exitCode = exitCode;
