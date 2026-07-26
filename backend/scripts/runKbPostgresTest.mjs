/**
 * Loads backend/.env explicitly, then runs the opt-in real-Postgres KB suite.
 * Jest's normal setup deliberately supplies a fake URL for unit tests, so the
 * live proof needs this wrapper to pass the disposable development DB URL into
 * the child process before Prisma is imported.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(backendDir, ".env");
if (!existsSync(envPath)) {
  throw new Error(`Missing ${envPath}; configure DATABASE_URL before running the PostgreSQL KB proof`);
}
const parsed = dotenv.parse(readFileSync(envPath));
const databaseUrl = process.env.DATABASE_URL || parsed.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the PostgreSQL KB proof");
}
const parsedDatabaseUrl = new URL(databaseUrl);
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
if (
  !localHosts.has(parsedDatabaseUrl.hostname) &&
  process.env.KB_POSTGRES_TESTS_ALLOW_NONLOCAL !== "1"
) {
  throw new Error(
    "Refusing to run the fixture-writing KB proof against a non-local database. " +
    "Use the disposable local database, or explicitly set " +
    "KB_POSTGRES_TESTS_ALLOW_NONLOCAL=1 for an isolated CI database."
  );
}

const jestBin = path.join(backendDir, "node_modules", "jest", "bin", "jest.js");
const result = spawnSync(
  process.execPath,
  [
    jestBin,
    "src/repositories/kbArticleRepository.postgres.test.ts",
    "--runInBand",
  ],
  {
    cwd: backendDir,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      KB_POSTGRES_TESTS: "1",
    },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
