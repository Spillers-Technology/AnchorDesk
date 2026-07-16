/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  // Only unit-level suites that don't need a live DB run by default.
  testMatch: ['**/?(*.)+(spec|test).ts'],
  // @swc/jest transpiles TS for tests (ts-jest caps at TypeScript <7).
  // Type checking is `npm run build`'s job, matching CI order.
  // sanitize-html's parser tree (htmlparser2 v12 + dom* v6+) and otplib 13's
  // crypto/base32 plugins (@scure, @noble) ship ESM-only. Node 22 require(esm)
  // handles them at runtime, but Jest's registry can't, so those package trees
  // (and only those) are transpiled to CJS for tests as well.
  transform: {
    '^.+\\.(t|j)s$': [
      '@swc/jest',
      {
        jsc: { parser: { syntax: 'typescript' }, target: 'esnext' },
        module: { type: 'commonjs' },
      },
    ],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(.*/)?(htmlparser2|entities|domhandler|domutils|dom-serializer|domelementtype|@scure|@noble|@otplib|otplib)/)',
  ],
};
