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

// Adopting an existing `db push` database means telling Prisma that 0_init is
// already applied. That is only true for the 2.8.x line: 0_init is the 2.8
// datamodel verbatim (CI proves it against prisma/baseline/schema-2.8.prisma),
// and every 2.8.x release installs a byte-identical schema. An older install
// lacks tables 0_init creates; recording 0_init against it would leave them
// missing forever while reporting the baseline as applied.
//
// So before resolving, diff the live database against the frozen 2.8
// datamodel. Prisma's diff is blind to the extensions, GIN/partial/functional
// indexes, CHECK constraints, and triggers that pgExtras.ts owns, so a real
// 2.8.x install differs by exactly the two plain B-tree indexes pgExtras adds
// beyond schema.prisma. Anything else fails closed.
const BASELINE_DATAMODEL = path.join(backendRoot, 'prisma', 'baseline', 'schema-2.8.prisma');
const PGEXTRAS_OWNED_BASELINE_DRIFT = new Set([
  'DROP INDEX "idx_ticket_events_assignee_occurred"',
  'DROP INDEX "idx_ticket_events_team_occurred"',
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
  return diffStatements(result.stdout).filter(
    (statement) => !PGEXTRAS_OWNED_BASELINE_DRIFT.has(statement),
  );
}

let exitCode = 1;
try {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      current_schema()::text AS "schemaName",
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = '_prisma_migrations'
          AND table_type = 'BASE TABLE'
      ) AS "hasMigrationsTable",
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'tickets'
          AND table_type = 'BASE TABLE'
      ) AS "hasSentinel",
      (
        SELECT count(*)::int
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name <> '_prisma_migrations'
          AND table_type = 'BASE TABLE'
      ) AS "otherTableCount"
  `);
  const state = rows[0];
  if (rows.length !== 1 || !state?.schemaName) {
    throw new Error('Could not resolve the current PostgreSQL schema.');
  }

  let shouldDeploy = false;
  if (state.hasMigrationsTable) {
    console.log(
      `Schema "${state.schemaName}" already has _prisma_migrations; ` +
        'running prisma migrate deploy.',
    );
    shouldDeploy = true;
  } else if (state.otherTableCount === 0) {
    console.log(
      `Schema "${state.schemaName}" has no application tables; ` +
        'running prisma migrate deploy for a fresh install.',
    );
    shouldDeploy = true;
  } else if (state.hasSentinel) {
    console.log(
      `Schema "${state.schemaName}" has tickets but no _prisma_migrations; ` +
        'checking it matches the AnchorDesk 2.8.x schema before adopting it as the 0_init baseline.',
    );
    const unexpected = unexpectedBaselineDrift();
    let resolveStatus = null;
    if (unexpected.length > 0) {
      console.error(
        `Refusing to adopt schema "${state.schemaName}": it does not match the AnchorDesk 2.8.x ` +
          `schema (${unexpected.length} unexpected difference(s)). Only a 2.8.x install can be ` +
          'upgraded to versioned migrations in place. Upgrade to 2.8.2 first with the 2.8.2 image, ' +
          'confirm it starts, then upgrade again. Nothing was changed. First differences:',
      );
      for (const statement of unexpected.slice(0, 10)) {
        console.error(`  ${statement.length > 200 ? `${statement.slice(0, 200)}…` : statement}`);
      }
      exitCode = 1;
    } else {
      console.log('Schema matches AnchorDesk 2.8.x; marking 0_init as applied.');
      resolveStatus = runPrisma(['migrate', 'resolve', '--applied', '0_init']);
    }
    if (resolveStatus === 0) {
      shouldDeploy = true;
    } else if (resolveStatus !== null) {
      // Do not replace this tolerance check with an advisory lock held while the
      // CLI runs. PrismaClient pools connections, so connection-affine locking
      // and unlocking across the subprocess boundary would not be reliable.
      let baselineWasApplied = false;
      try {
        const schema = quoteIdentifier(state.schemaName);
        const appliedRows = await prisma.$queryRawUnsafe(`
          SELECT EXISTS (
            SELECT 1
            FROM ${schema}."_prisma_migrations"
            WHERE migration_name = '0_init'
              AND finished_at IS NOT NULL
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
    console.error(
      `Schema "${state.schemaName}" has ${state.otherTableCount} base table(s), ` +
        'but has neither _prisma_migrations nor tickets. Refusing to guess its state; ' +
        'inspect the database manually before retrying.',
    );
    exitCode = 1;
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
