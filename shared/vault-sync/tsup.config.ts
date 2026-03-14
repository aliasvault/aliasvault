import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  target: 'es2020',
  dts: true,
  clean: true,
  splitting: false,
  minify: false,
  sourcemap: false,
  external: ['@aliasvault/contract', '@aliasvault/ipfs-service'],
  noExternal: ['@aliasvault/vault-types', '@aliasvault/models', 'secrets.js-34r7h'],
});
