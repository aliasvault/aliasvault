/**
 * Node-side platform registration for the shared client core (`@aliasvault/client`).
 *
 * Import this module for its side effect from any helper that touches the core.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRustSqliteEngine } from '@aliasvault/client/database/RustSqliteEngine';
import { setPlatform } from '@aliasvault/client/platform';
import { createInMemoryPlatform } from '@aliasvault/client/platform/InMemoryPlatform';
import { createWasmRustCore } from '@aliasvault/client/rust/WasmRustCore';

const clientCoreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../core/client');

/*
 * Playwright resolves the `#wasm/*` glue code through the `paths` of core/client/tsconfig.json, so read the binary from the
 * first build that exists in that same order.
 */
const wasmDir = ['wasm-extension', 'wasm-web'].map((dir) => path.join(clientCoreDir, dir)).find((dir) => existsSync(dir));
if (!wasmDir) {
  throw new Error('No Rust core WASM build in core/client, run `npm run build:rust` first.');
}

// The Rust core which also hosts the SQLite engine.
const rustCore = createWasmRustCore(async (): Promise<BufferSource> => readFileSync(path.join(wasmDir, 'aliasvault_core_bg.wasm')));

setPlatform(createInMemoryPlatform({
  rustCore,
  sqlite: createRustSqliteEngine(rustCore),
}));
