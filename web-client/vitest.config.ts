// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest 4 transforms TS/JSX with oxc, which defaults to the automatic JSX
  // runtime — components use JSX without importing React, matching the app's
  // Vite React plugin. (The old `esbuild: { jsx: 'automatic' }` knob is ignored.)
  test: {
    environment: 'node', // Set the environment to Node.js
    // These suites render whole MUI views under jsdom, which costs seconds per
    // test — ReportsView and TicketSyncPanel sit at 4-7s locally and slower on a
    // shared CI runner, so the 5s default failed them intermittently on timeout
    // rather than on any assertion. Individual tests still narrow this (see the
    // explicit values in MergeTicketDialog.test.tsx); the ceiling is only here so
    // a slow machine is not reported as a broken test.
    testTimeout: 20_000,
  },
});
