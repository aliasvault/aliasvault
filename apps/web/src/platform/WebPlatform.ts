/**
 * The web app's implementation of the client core's platform interfaces.
 */

import { createRustSqliteEngine } from '@aliasvault/client/database/RustSqliteEngine';
import { type IClientPlatform } from '@aliasvault/client/platform';
import { createWasmRustCore } from '@aliasvault/client/rust/WasmRustCore';
import wasmUrl from '@aliasvault/client/wasm/aliasvault_core_bg.wasm?url';

import i18n from '@/i18n/i18n';
import { WebKeyValueStore } from '@/platform/WebKeyValueStore';
import { devError, devLog, devWarn } from '@/utils/DevLogger';

import type { TranslationKey } from '@aliasvault/i18n';

/**
 * The Rust core, streamed into WebAssembly.instantiateStreaming; it also hosts the SQLite engine.
 */
const rustCore = createWasmRustCore(async (): Promise<Response> => {
  const host = window as { __aliasvaultCoreWasm?: Promise<Response> };
  const early = host.__aliasvaultCoreWasm;
  host.__aliasvaultCoreWasm = undefined;
  return early ? early.catch(() => fetch(wasmUrl)) : fetch(wasmUrl);
});

/**
 * The platform the web app registers with the client core.
 */
export const webPlatform: IClientPlatform = {
  storage: new WebKeyValueStore(),
  logger: { log: devLog, warn: devWarn, error: devError },
  app: {
    version: __APP_VERSION__,
    clientName: 'web',
  },
  rustCore,
  sqlite: createRustSqliteEngine(rustCore),
  /**
   * Translate a shared message through the app's i18n.
   */
  translate: async (key: TranslationKey): Promise<string> => i18n.t(key),
};
