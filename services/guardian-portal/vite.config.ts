import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// Vite 7 + WASM configuration following the bboard pattern.
// Cross-referenced with midnight-bank, MeshJS template, midnight-game-2.
// All Midnight browser DApps use vite-plugin-wasm + vite-plugin-top-level-await
// to handle ledger-v7 (10.4 MB) and onchain-runtime-v2 (1.4 MB) WASM modules.
export default defineConfig({
  cacheDir: './.vite',
  base: '/',
  build: {
    outDir: 'dist',
    target: 'esnext',
    minify: false,
    rollupOptions: {
      output: {
        // Function-based manualChunks to handle pnpm strict hoisting (Rule 13).
        // bboard uses array-based { wasm: ['@midnight-ntwrk/onchain-runtime-v2'] }
        // but that requires the package to be directly resolvable. Under pnpm,
        // onchain-runtime-v2 is a transitive dep of compact-runtime and not hoisted.
        manualChunks(id) {
          if (id.includes('@midnight-ntwrk/onchain-runtime-v2') || id.includes('@midnight-ntwrk/ledger-v7')) {
            return 'wasm';
          }
        },
      },
    },
    commonjsOptions: {
      // Transform CommonJS to ESM more aggressively
      transformMixedEsModules: true,
      extensions: ['.js', '.cjs'],
      // Needed for Node.js modules in midnight-js-contracts
      ignoreDynamicRequires: true,
    },
  },
  plugins: [
    react(),
    wasm(),
    topLevelAwait({
      promiseExportName: '__tla',
      promiseImportName: (i) => `__tla_${i}`,
    }),
    // Custom resolver for compact-runtime → onchain-runtime-v2 resolution
    {
      name: 'wasm-module-resolver',
      resolveId(source, importer) {
        if (
          source === '@midnight-ntwrk/onchain-runtime-v2' &&
          importer &&
          importer.includes('@midnight-ntwrk/compact-runtime')
        ) {
          return {
            id: source,
            external: false,
            moduleSideEffects: true,
          };
        }
        return null;
      },
    },
  ],
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
      supported: { 'top-level-await': true },
      platform: 'browser',
      format: 'esm',
      loader: {
        '.wasm': 'binary',
      },
    },
    include: ['@midnight-ntwrk/compact-runtime'],
    exclude: [
      '@midnight-ntwrk/ledger-v7',
      '@midnight-ntwrk/onchain-runtime-v2',
      '@midnight-ntwrk/onchain-runtime-v2/midnight_onchain_runtime_wasm_bg.wasm',
      '@midnight-ntwrk/onchain-runtime-v2/midnight_onchain_runtime_wasm.js',
    ],
  },
  resolve: {
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.wasm'],
    mainFields: ['browser', 'module', 'main'],
  },
});
