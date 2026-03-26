import { defineConfig } from 'tsup';
import path from 'path';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  target: 'es2020',
  platform: 'browser',
  dts: true,
  clean: true,
  splitting: false,
  minify: false,
  sourcemap: false,
  external: ['@aliasvault/contract', '@aliasvault/ipfs-service'],
  noExternal: ['@aliasvault/vault-types', '@aliasvault/models', 'secrets.js-34r7h'],
  esbuildOptions(options) {
    // secrets.js-34r7h UMD wrapper does require("crypto") in its CJS branch.
    // With platform:'browser', esbuild won't auto-externalize it but can't find it either.
    // Alias to a shim that re-exports the Web Crypto API global.
    options.alias = {
      crypto: path.resolve(__dirname, 'src/crypto-shim.js'),
    };
  },
});
