import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', include: ['packages/shared/src/**/*.test.ts'] } },
      { test: { name: 'server', include: ['server/src/**/*.test.ts'] } },
      {
        test: {
          name: 'access',
          include: ['tests/**/*.test.ts'],
          setupFiles: ['tests/setup.ts'],
          // Shared hosted DB, reset per test: run these files one at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
