import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The access suite shares one hosted DB and resets it per test: run files one at a time.
    fileParallelism: false,
    projects: [
      { test: { name: 'shared', include: ['packages/shared/src/**/*.test.ts'] } },
      { test: { name: 'server', include: ['server/src/**/*.test.ts'] } },
      {
        test: {
          name: 'access',
          include: ['tests/**/*.test.ts'],
          setupFiles: ['tests/setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
