import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // D-095: several tests run the whole 15-fixture pipeline (xlsx + PDFs) one or more times; under a full
    // parallel run on Windows they sometimes passed 5 s (the default) and timed out at random. No assertion changed.
    testTimeout: 30_000,
  },
});
