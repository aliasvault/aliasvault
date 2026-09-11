/**
 * Node-side platform registration for the shared client core (`@aliasvault/client`).
 *
 * Import this module for its side effect from any helper that touches the core.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSqlJsEngine } from '@aliasvault/client/database/SqlJsEngine';
import { setPlatform } from '@aliasvault/client/platform';
import { createInMemoryPlatform } from '@aliasvault/client/platform/InMemoryPlatform';
import { createWasmRustCore } from '@aliasvault/client/rust/WasmRustCore';

const clientCoreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../core/client');
const requireFromClientCore = createRequire(path.join(clientCoreDir, 'package.json'));

setPlatform(createInMemoryPlatform({
  // The Rust core WASM from the client core build output.
  rustCore: createWasmRustCore(async (): Promise<BufferSource> => readFileSync(path.join(clientCoreDir, 'wasm/aliasvault_core_bg.wasm'))),
  // sql.js support files from the client core's node_modules.
  sqlite: createSqlJsEngine((file: string): string => path.join(path.dirname(requireFromClientCore.resolve('sql.js')), file)),
}));
