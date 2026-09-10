import type { IAppIdentity } from './AppIdentity';
import type { IKeyValueStore } from './KeyValueStore';
import type { ILogger } from './Logger';
import type { TranslatableMessage } from './TranslatableMessage';

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

  /**
   * Provide the Rust core WebAssembly binary. Called once per realm, lazily, on the first core call.
   */
  loadRustCoreWasm(): Promise<BufferSource | Response>;

  /**
   * Resolve a sql.js support file (`sql-wasm.wasm`) to a URL the runtime can fetch.
   * @param file - the file name sql.js asks for
   */
  locateSqlJsFile(file: string): string;

  /**
   * Translate one of the core's own messages into the user's language.
   */
  translate(message: TranslatableMessage): Promise<string>;
}

let current: IClientPlatform | null = null;

/**
 * Register the host platform. Call once at startup of every JS realm (a service worker and a popup document are
 * separate realms and each need their own call). Calling it again replaces the platform.
 * @param platform - the host implementation
 */
export function setPlatform(platform: IClientPlatform): void {
  current = platform;
}

/**
 * The registered host platform.
 * @throws Error when no platform was registered yet.
 */
export function getPlatform(): IClientPlatform {
  if (!current) {
    throw new Error('AliasVault client platform is not configured. Call setPlatform() before using the client core.');
  }
  return current;
}

/**
 * The registered host platform, or null before registration. For code paths that must stay usable without a
 * platform, such as logging.
 */
export function tryGetPlatform(): IClientPlatform | null {
  return current;
}
