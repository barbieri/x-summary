import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['tests/setup-env.ts'],
    include: ['tests/**/*.test.ts'],
    // Live X tests share one persistent Chrome profile via tests/live-x-harness.ts.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
});
