import { setPlatform, unavailableService } from '@aliasvault/client/platform';

import type { IClientPlatform, IKeyValueStore, ISqliteEngine } from '@aliasvault/client/platform';
import type { TranslationKey } from '@aliasvault/i18n';

import i18n from '@/i18n';
import { nativeRustCore } from '@/platform/NativeRustCore';
import NativeVaultManager from '@/specs/NativeVaultManager';
import { MobileAppIdentity } from '@/utils/AppInfo';

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
  },
  rustCore: nativeRustCore,
  sqlite: unavailableService<ISqliteEngine>('SQLite engine'),
  /**
   * Translate a shared message through the app's i18n.
   */
  translate: async (key: TranslationKey): Promise<string> => i18n.t(key),
  /**
   * Whether this device holds a key chain; the app keeps it in native storage.
   */
  hasLocalVaultKey: async (): Promise<boolean> => (await NativeVaultManager.getAccountKeyChain()) !== null,
  /**
   * The app's UI language.
   */
  deviceLanguage: (): string => i18n.language || 'en',
};

setPlatform(mobilePlatform);
