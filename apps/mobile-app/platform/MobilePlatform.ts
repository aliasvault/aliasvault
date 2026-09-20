import { setPlatform, TranslatableMessage } from '@aliasvault/client/platform';
import { unavailableService } from '@aliasvault/client/platform/InMemoryPlatform';

import type { IClientPlatform, IKeyValueStore, ISqliteEngine } from '@aliasvault/client/platform';

import i18n from '@/i18n';
import { nativeRustCore } from '@/platform/NativeRustCore';
import { MobileAppIdentity } from '@/utils/AppInfo';

/**
 * Which translation key backs each of the client core's own messages.
 */
const TRANSLATION_KEYS: Record<TranslatableMessage, string> = {
  [TranslatableMessage.ClientOutdated]: 'vault.errors.appOutdated',
  [TranslatableMessage.SharedFolderDeleteRefused]: 'items.folders.deleteSharedFolderHint',
  [TranslatableMessage.VaultUpgradeRequired]: 'vault.errors.vaultOutdated',
};

/*
 * Only the client core's repositories and Rust wrappers run on mobile. Tokens, sync state and the vault itself live
 * in native storage and the vault database is native too, so the core's key-value storage and in-JS SQLite engine
 * are not provided and instead will throw an error in case they are called (by mistake).
 */
const mobilePlatform: IClientPlatform = {
  storage: unavailableService<IKeyValueStore>('key-value storage'),
  logger: {
    /**
     * Log a dev trace.
     */
    log: (message: string, ...args: unknown[]): void => {
      if (__DEV__) {
        console.debug(message, ...args);
      }
    },
    /**
     * Log a dev warning.
     */
    warn: (message: string, ...args: unknown[]): void => {
      if (__DEV__) {
        console.warn(message, ...args);
      }
    },
    /**
     * Log a dev error.
     */
    error: (message: string, ...args: unknown[]): void => {
      if (__DEV__) {
        console.error(message, ...args);
      }
    },
  },
  app: {
    version: MobileAppIdentity.VERSION,
    clientName: MobileAppIdentity.CLIENT_NAME,
    isDevelopment: __DEV__,
  },
  rustCore: nativeRustCore,
  sqlite: unavailableService<ISqliteEngine>('SQLite engine'),
  /**
   * Translate one of the core's own messages through the app's i18n.
   */
  translate: async (message: TranslatableMessage): Promise<string> => i18n.t(TRANSLATION_KEYS[message]),
  /**
   * The app's UI language.
   */
  deviceLanguage: (): string => i18n.language || 'en',
};

setPlatform(mobilePlatform);
