import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    // Default env is node (fast, matches the pure-logic + query tests). Component tests opt into
    // jsdom per-file via a `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: [
      'lib/**/*.test.{ts,tsx}',
      'app/**/*.test.{ts,tsx}',
      'components/**/*.test.{ts,tsx}',
      'scripts/**/*.test.{ts,tsx}',
    ],
  },
});
