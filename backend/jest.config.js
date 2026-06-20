/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  // Only unit-level suites that don't need a live DB run by default.
  testMatch: ['**/?(*.)+(spec|test).ts'],
};
