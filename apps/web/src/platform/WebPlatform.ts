/**
 * The web app's implementation of the client core's platform interfaces.
 */

import { createRustSqliteEngine } from '@aliasvault/client/database/RustSqliteEngine';
import { type IClientPlatform, TranslatableMessage } from '@aliasvault/client/platform';
import { createWasmRustCore } from '@aliasvault/client/rust/WasmRustCore';
import wasmUrl from '@aliasvault/client/wasm/aliasvault_core_bg.wasm?url';

import i18n from '@/i18n/i18n';
import { WebKeyValueStore } from '@/platform/WebKeyValueStore';
import { devError, devLog, devWarn } from '@/utils/DevLogger';

/**
 * Which translation key backs each of the core's own messages.
 */
const TRANSLATION_KEYS: Record<TranslatableMessage, string> = {
  [TranslatableMessage.ClientOutdated]: 'common.clientVersionUnsupported',
  [TranslatableMessage.VaultUpgradeRequired]: 'content.vaultUpgradeRequired',
};

/**
 * The Rust core, streamed into WebAssembly.instantiateStreaming; it also hosts the SQLite engine. The wasm URL is
 * content hashed by Vite, so a new build never loads a cached binary from an older release.
 */
const rustCore = createWasmRustCore(async (): Promise<Response> => fetch(wasmUrl));

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
   * Translate one of the core's own messages through the app's i18n.
   */
  translate: async (message: TranslatableMessage): Promise<string> => i18n.t(TRANSLATION_KEYS[message]),
};
