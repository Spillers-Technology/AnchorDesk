import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suppliedUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();

if (!suppliedUrl) {
  console.error(
    'POSTGRES_TEST_DATABASE_URL is required. Supply a disposable PostgreSQL database URL; ' +
      'the runner creates and drops one isolated anchordesk_ws_a_test_* schema in it.',
  );
  process.exit(2);
}

let baseUrl;
try {
  baseUrl = new URL(suppliedUrl);
} catch {
  console.error('POSTGRES_TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  process.exit(2);
}

if (baseUrl.protocol !== 'postgresql:' && baseUrl.protocol !== 'postgres:') {
  console.error('POSTGRES_TEST_DATABASE_URL must use the postgresql:// or postgres:// protocol.');
  process.exit(2);
}

// Never reset or reuse the URL's existing schema. Each invocation owns one
// randomly named schema, and cleanup is restricted to that generated name.
baseUrl.searchParams.delete('schema');
const schemaName =
  `anchordesk_ws_a_test_${process.pid}_${Date.now()}_${randomBytes(4).toString('hex')}`;
if (!/^anchordesk_ws_a_test_[a-z0-9_]+$/.test(schemaName)) {
  throw new Error('Refusing to operate on an unexpected PostgreSQL schema name');
}

const schemaUrl = new URL(baseUrl);
schemaUrl.searchParams.set('schema', schemaName);
const childEnv = {
  ...process.env,
  DATABASE_URL: schemaUrl.toString(),
  ANCHORDESK_POSTGRES_INTEGRATION: '1',
};
const prismaCli = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js');
const jestCli = path.join(backendRoot, 'node_modules', 'jest', 'bin', 'jest.js');
const admin = new PrismaClient({ datasourceUrl: baseUrl.toString() });

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: backendRoot,
    env: childEnv,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

let exitCode = 1;
try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  const databaseName = decodeURIComponent(baseUrl.pathname.replace(/^\//, '')) || '(default)';
  console.log(
    `Running Workstream A PostgreSQL integration tests in schema ${schemaName} ` +
      `on ${baseUrl.hostname}/${databaseName}`,
  );

  const pushStatus = runNode(prismaCli, ['db', 'push', '--skip-generate']);
  if (pushStatus !== 0) {
    console.error(`prisma db push failed with exit code ${pushStatus}`);
    exitCode = pushStatus;
  } else {
    exitCode = runNode(jestCli, [
      '--config',
      'jest.postgres.config.js',
      '--runInBand',
    ]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
} finally {
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } catch (error) {
    console.error(
      `Failed to remove isolated PostgreSQL schema ${schemaName}: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    exitCode = 1;
  } finally {
    await admin.$disconnect();
  }
}

process.exitCode = exitCode;
