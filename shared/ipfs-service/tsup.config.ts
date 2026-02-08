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
  external: ['@aliasvault/contract', 'pinata'],
});
