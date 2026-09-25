/**
 * Node-side platform registration for the shared client core (`@aliasvault/client`).
 *
 * Import this module for its side effect from any helper that touches the core.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRustSqliteEngine } from '@aliasvault/client/database/RustSqliteEngine';
import { setPlatform } from '@aliasvault/client/platform';
import { createInMemoryPlatform } from '@aliasvault/client/platform/InMemoryPlatform';
import { createWasmRustCore } from '@aliasvault/client/rust/WasmRustCore';

const clientCoreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../core/client');

// The Rust core which also hosts the SQLite engine.
const rustCore = createWasmRustCore(async (): Promise<BufferSource> => readFileSync(path.join(clientCoreDir, 'wasm/aliasvault_core_bg.wasm')));

setPlatform(createInMemoryPlatform({
  rustCore,
  sqlite: createRustSqliteEngine(rustCore),
}));
