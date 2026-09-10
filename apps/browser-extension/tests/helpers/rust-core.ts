/**
 * Node-side loader for the AliasVault Rust core (WASM).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { initSync } from '@aliasvault/client/wasm/aliasvault_core.js';

let wasmInitialized = false;

/**
 * Initializes the Rust core WASM module from the linked client core package (idempotent).
 */
export function ensureRustCore(): void {
  if (!wasmInitialized) {
    const wasmPath = join(process.cwd(), 'node_modules/@aliasvault/client/wasm/aliasvault_core_bg.wasm');
    initSync({ module: readFileSync(wasmPath) });
    wasmInitialized = true;
  }
}
