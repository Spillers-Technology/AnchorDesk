// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Match Vite's React plugin: components use JSX without importing React.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node', // Set the environment to Node.js
  },
});
