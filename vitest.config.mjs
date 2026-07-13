import { defineConfig } from 'vitest/config';

// Explicit repo-root config so Vitest does not walk up the filesystem and pick
// up an unrelated parent vite.config.* (which breaks test discovery locally).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
