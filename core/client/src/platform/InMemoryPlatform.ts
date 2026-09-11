import type { IClientPlatform } from './ClientPlatform';
import type { IKeyValueStore, StorageKey } from './KeyValueStore';
import type { ISqliteEngine } from './SqliteEngine';
import type { IRustCore } from '../rust/RustCoreBinding';

/**
 * A {@link IKeyValueStore} held in a Map. For unit tests and for hosts that keep session state in memory only.
 */
export class InMemoryKeyValueStore implements IKeyValueStore {
  private readonly values = new Map<string, unknown>();
  private readonly watchers = new Map<string, Set<(value: unknown) => void>>();

  /** @inheritdoc */
  public async get<T = unknown>(key: StorageKey): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  /** @inheritdoc */
  public async set(key: StorageKey, value: unknown): Promise<void> {
    this.values.set(key, value);
    this.notify(key, value);
  }

  /** @inheritdoc */
  public async setMany(entries: { key: StorageKey; value: unknown }[]): Promise<void> {
    for (const entry of entries) {
      await this.set(entry.key, entry.value);
    }
  }

  /** @inheritdoc */
  public async remove(key: StorageKey): Promise<void> {
    this.values.delete(key);
    this.notify(key, null);
  }

  /** @inheritdoc */
  public async removeMany(keys: StorageKey[]): Promise<void> {
    for (const key of keys) {
      await this.remove(key);
    }
  }

  /** @inheritdoc */
  public watch<T = unknown>(key: StorageKey, callback: (value: T | null) => void): () => void {
    const set = this.watchers.get(key) ?? new Set();
    /**
     * Forward a stored value to the caller's typed callback.
     */
    const listener = (value: unknown): void => callback(value as T | null);
    set.add(listener);
    this.watchers.set(key, set);
    return (): void => {
      set.delete(listener);
    };
  }

  /**
   * Notify watchers of a key.
   */
  private notify(key: string, value: unknown): void {
    this.watchers.get(key)?.forEach(listener => listener(value));
  }
}

/**
 * A Rust core or SQLite engine that refuses every call, for platforms that did not provide one.
 * @param what - the member name, for the error message
 */
function unavailable<T extends object>(what: string): T {
  return new Proxy({} as T, {
    /** Every member access yields a rejecting function. */
    get: (_target, property): unknown => (): Promise<never> => Promise.reject(new Error(`No ${what} configured for this platform (${String(property)}).`)),
  });
}

/**
 * A platform with in-memory storage and no-op logging, for unit tests. Override what the test needs (typically
 * the Rust core binding and the SQLite engine).
 * @param overrides - members to replace
 */
export function createInMemoryPlatform(overrides: Partial<IClientPlatform> = {}): IClientPlatform {
  return {
    storage: new InMemoryKeyValueStore(),
    logger: {
      /** Discard. */
      log: (): void => {},
      /** Discard. */
      warn: (): void => {},
      /** Discard. */
      error: (): void => {},
    },
    app: { version: '0.0.0-test', clientName: 'test', isDevelopment: false },
    rustCore: unavailable<IRustCore>('Rust core'),
    sqlite: unavailable<ISqliteEngine>('SQLite engine'),
    /**
     * Echo the message id.
     */
    translate: async (message): Promise<string> => message,
    ...overrides,
  };
}
