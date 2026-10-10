import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests use the shared package's source, so they don't depend on a prior build.
    alias: {
      '@rta/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['apps/**/src/**/*.test.ts', 'packages/**/src/**/*.test.ts'] },
});
