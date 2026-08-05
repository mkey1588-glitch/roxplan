import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests are colocated as *.test.ts (CLAUDE.md). Nothing under app/ or
    // components/ is tested yet — engine tests come first by design.
    include: ['lib/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': import.meta.dirname,
    },
  },
});
