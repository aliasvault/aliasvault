/**
 * Node-side loader for the AliasVault Rust core (WASM).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { initSync } from '../../src/utils/dist/core/rust/aliasvault_core.js';

let wasmInitialized = false;

/**
 * Initializes the Rust core WASM module from the extension's dist (idempotent).
 */
export function ensureRustCore(): void {
  if (!wasmInitialized) {
    const wasmPath = join(process.cwd(), 'src/utils/dist/core/rust/aliasvault_core_bg.wasm');
    initSync({ module: readFileSync(wasmPath) });
    wasmInitialized = true;
  }
}
