/**
 * The browser extension's implementations of the client core's platform interfaces (e.g. storage, logger, etc.) which are different per platform.
 */

import { createRustSqliteEngine } from '@aliasvault/client/database/RustSqliteEngine';
import { type IClientPlatform, type IKeyValueStore, type StorageKey, TranslatableMessage } from '@aliasvault/client/platform';
import { createWasmRustCore } from '@aliasvault/client/rust/WasmRustCore';

import { devError, devLog, devWarn } from '@/utils/devLogger/DevLogger';

import { t } from '@/i18n/StandaloneI18n';

import { browser, storage } from '#imports';

/**
 * The current extension version. This should be updated with each release of the extension.
 */
export const EXTENSION_VERSION = '0.31.0-alpha';

/**
 * The client name to use in the X-AliasVault-Client header, detected from the WXT build target.
 */
function detectClientName(): 'chrome' | 'firefox' | 'edge' | 'safari' | 'browser' {
  const env = import.meta.env;
  if (env.FIREFOX) {
    return 'firefox';
  }
  if (env.CHROME) {
    return 'chrome';
  }
  if (env.EDGE) {
    return 'edge';
  }
  if (env.SAFARI) {
    return 'safari';
  }
  return 'browser';
}

/** 
 * Which translation key backs each of the core's own messages. 
 * TODO: refactor this to use centralized translation system instead (on to-do list) once that is implemented.
 */
const TRANSLATION_KEYS: Record<TranslatableMessage, string> = {
  [TranslatableMessage.ClientOutdated]: 'common.errors.browserExtensionOutdated',
  [TranslatableMessage.VaultUpgradeRequired]: 'content.vaultUpgradeRequired',
};

/**
 * WXT storage.
 */
const extensionStorage: IKeyValueStore = {
  /**
   * Read a key.
   */
  get: <T,>(key: StorageKey): Promise<T | null> => storage.getItem<T>(key),
  /**
   * Write a key.
   */
  set: (key: StorageKey, value: unknown): Promise<void> => storage.setItem(key, value),
  /**
   * Write several keys.
   */
  setMany: (entries: { key: StorageKey; value: unknown }[]): Promise<void> => storage.setItems(entries),
  /**
   * Remove a key.
   */
  remove: (key: StorageKey): Promise<void> => storage.removeItem(key),
  /**
   * Remove several keys.
   */
  removeMany: (keys: StorageKey[]): Promise<void> => storage.removeItems(keys),
  /**
   * Watch a key.
   */
  watch: <T,>(key: StorageKey, callback: (value: T | null) => void): (() => void) => storage.watch<T>(key, (value) => callback(value)),
};

/**
 * The Rust core which also hosts the SQLite engine.
 */
const rustCore = createWasmRustCore(async (): Promise<BufferSource> => {
  const wasmUrl = (browser.runtime.getURL as (path: string) => string)('src/aliasvault_core_bg.wasm');
  return (await fetch(wasmUrl)).arrayBuffer();
});

/**
 * The platform the extension registers with the client core.
 */
export const extensionPlatform: IClientPlatform = {
  storage: extensionStorage,
  logger: { log: devLog, warn: devWarn, error: devError },
  app: {
    version: EXTENSION_VERSION,
    clientName: detectClientName(),
    isDevelopment: import.meta.env.DEV,
  },
  rustCore,
  sqlite: createRustSqliteEngine(rustCore),
  /**
   * Translate one of the core's own messages through the extension's i18n.
   */
  translate: (message: TranslatableMessage): Promise<string> => t(TRANSLATION_KEYS[message]),
};
