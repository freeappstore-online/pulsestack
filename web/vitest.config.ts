import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so tests don't load the PWA/Tailwind plugins.
// TZ is pinned to a zone with DST so the date/DST edge-case tests are
// deterministic on every machine (see decision.md D-011).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: { TZ: 'America/New_York' },
  },
})
