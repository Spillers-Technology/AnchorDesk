/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  // Only unit-level suites that don't need a live DB run by default.
  testMatch: ['**/?(*.)+(spec|test).ts'],
  // sanitize-html's parser tree (htmlparser2 v12 + dom* v6+) and otplib 13's
  // crypto/base32 plugins (@scure, @noble) ship ESM-only. Node 22 require(esm)
  // handles them at runtime, but Jest's registry can't, so let ts-jest
  // transpile those packages (and only those) to CJS for tests.
  transform: {
    '^.+\\.ts$': ['ts-jest', {}],
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs' } }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(.*/)?(htmlparser2|entities|domhandler|domutils|dom-serializer|domelementtype|@scure|@noble|@otplib|otplib)/)',
  ],
};
