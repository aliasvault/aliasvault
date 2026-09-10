/**
 * Node-side platform registration for the shared client core (`@aliasvault/client`).
 *
 * Import this module for its side effect from any helper that touches the core.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { setPlatform } from '@aliasvault/client/platform';
import { createInMemoryPlatform } from '@aliasvault/client/platform/InMemoryPlatform';

const clientCoreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../core/client');
const requireFromClientCore = createRequire(path.join(clientCoreDir, 'package.json'));

setPlatform(createInMemoryPlatform({
  /**
   * Load the Rust core WASM from the client core build output.
   */
  loadRustCoreWasm: async (): Promise<BufferSource> => readFileSync(path.join(clientCoreDir, 'wasm/aliasvault_core_bg.wasm')),
  /**
   * Locate a sql.js support file in the client core's node_modules.
   * @param file - the file name sql.js asks for
   */
  locateSqlJsFile: (file: string): string => path.join(path.dirname(requireFromClientCore.resolve('sql.js')), file),
}));
