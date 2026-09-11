import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { createSqlJsEngine } from './src/database/SqlJsEngine';
import { setPlatform } from './src/platform/ClientPlatform';
import { createInMemoryPlatform } from './src/platform/InMemoryPlatform';
import { createWasmRustCore } from './src/rust/WasmRustCore';

const require = createRequire(import.meta.url);

/*
 * Registers a Node-backed platform for the unit tests: WASM from the local build output, sql.js from node_modules.
 */
setPlatform(createInMemoryPlatform({
  rustCore: createWasmRustCore(async (): Promise<BufferSource> => readFileSync(path.join(import.meta.dirname, 'wasm/aliasvault_core_bg.wasm'))),
  sqlite: createSqlJsEngine((file: string): string => path.join(path.dirname(require.resolve('sql.js')), file)),
}));
