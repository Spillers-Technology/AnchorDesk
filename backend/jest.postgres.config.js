const unitConfig = require('./jest.config');

/** @type {import('jest').Config} */
module.exports = {
  ...unitConfig,
  // This suite is invoked only by scripts/run-postgres-tests.mjs. Keeping it
  // outside the unit config means `npm test` never attempts a database
  // connection, while the dedicated runner fails rather than silently skips
  // when no disposable PostgreSQL URL was supplied.
  testMatch: ['<rootDir>/integration/**/*.postgres.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
};
