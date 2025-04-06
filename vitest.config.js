// vitest.config.js
import { defineConfig } from 'vitest/config';
import path from 'path'; // Import the path module

export default defineConfig({
  test: {
    // Use jsdom to simulate a browser environment for tests
    environment: 'jsdom',
    // Optional: You might want to configure other options here later
    // globals: true, // If you want vitest globals like describe, it, etc. available without imports
  },
  // Add path alias configuration
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});