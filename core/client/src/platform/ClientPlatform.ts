import type { IAppIdentity } from './AppIdentity';
import type { IKeyValueStore } from './KeyValueStore';
import type { ILogger } from './Logger';
import type { ISqliteEngine } from './SqliteEngine';
import type { IRustCore } from '../rust/RustCoreBinding';
import type { TranslationKey } from '@aliasvault/i18n';

/**
 * Everything the client core needs from the host app. Each app (browser extension, web app, mobile app) implements
 * this once and registers it with {@link setPlatform} before any core service is used.
 */
export interface IClientPlatform {
  /** Key-value storage for tokens, sync state and cached vault material. */
  storage: IKeyValueStore;

  /** Dev logging sink. */
  logger: ILogger;

  /** Version and client name of the host app. */
  app: IAppIdentity;

  /** The Rust core: WebAssembly on the web hosts (see WasmRustCore), the native uniffi bindings on mobile. */
  rustCore: IRustCore;

  /** The SQLite engine the vault is opened with. */
  sqlite: ISqliteEngine;

  /**
   * Translate a message of the shared translations (core/i18n) into the user's language.
   */
  translate(key: TranslationKey): Promise<string>;

  /**
   * Whether this device holds a key chain, for hosts that keep it outside {@link storage} (the mobile app keeps it in native storage).
   */
  hasLocalVaultKey?(): Promise<boolean>;

  /**
   * The device's UI language as a BCP 47 tag. Hosts without `navigator.language` provide it here.
   */
  deviceLanguage?(): string;

  /**
   * Extra headers to send with every API request, e.g. the custom proxy headers a self-hosted setup needs.
   */
  requestHeaders?(): Promise<Record<string, string>>;
}

let current: IClientPlatform | null = null;

/**
 * Register the host platform.
 * @param platform - the host implementation
 */
export function setPlatform(platform: IClientPlatform): void {
  current = platform;
}

/**
 * The registered host platform.
 * @throws When no platform has been registered yet.
 */
export function getPlatform(): IClientPlatform {
  if (!current) {
    throw new Error('No client platform registered. Call setPlatform() before using the client core.');
  }
  return current;
}

/**
 * The registered host platform, or null before registration. For code paths that must stay silent early on.
 */
export function tryGetPlatform(): IClientPlatform | null {
  return current;
}
