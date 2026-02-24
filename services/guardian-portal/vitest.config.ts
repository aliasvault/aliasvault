import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // @midnight-ntwrk/compact-js is not installed locally (private registry);
      // alias to a stub so vi.mock can intercept imports in tests
      '@midnight-ntwrk/compact-js': resolve(__dirname, 'src/__mocks__/compact-js-stub.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
