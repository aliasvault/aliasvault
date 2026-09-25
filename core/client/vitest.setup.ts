import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createRustSqliteEngine } from './src/database/RustSqliteEngine';
import { setPlatform } from './src/platform/ClientPlatform';
import { createInMemoryPlatform } from './src/platform/InMemoryPlatform';
import { createWasmRustCore } from './src/rust/WasmRustCore';

/*
 * Registers a Node-backed platform for the unit tests.
 */
const rustCore = createWasmRustCore(async (): Promise<BufferSource> => readFileSync(path.join(import.meta.dirname, 'wasm/aliasvault_core_bg.wasm')));
setPlatform(createInMemoryPlatform({
  rustCore,
  sqlite: createRustSqliteEngine(rustCore),
}));
