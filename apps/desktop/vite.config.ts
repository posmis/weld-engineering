import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  test: {
    environment: 'jsdom',
    // Shared Windows runners may pause during the first React/ICU render.
    // Keep assertions and async act flushing; allow cold-start scheduling slack.
    testTimeout: 15_000,
  },
});
