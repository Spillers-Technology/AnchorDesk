// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest 4 transforms TS/JSX with oxc, which defaults to the automatic JSX
  // runtime — components use JSX without importing React, matching the app's
  // Vite React plugin. (The old `esbuild: { jsx: 'automatic' }` knob is ignored.)
  test: {
    environment: 'node', // Set the environment to Node.js
  },
});
