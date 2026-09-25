/**
 * A storage key, scoped to either the persisted (local) or the memory-only (session) area.
 */
export type StorageKey = `local:${string}` | `session:${string}`;

/**
 * Key-value storage the host provides to the client core. Values are JSON-serializable.
 */
export interface IKeyValueStore {
  /**
   * Read a value, or null when the key is not set.
   */
  get<T = unknown>(key: StorageKey): Promise<T | null>;

  /**
   * Write a value.
   */
  set(key: StorageKey, value: unknown): Promise<void>;

  /**
   * Write several values at once.
   */
  setMany(entries: { key: StorageKey; value: unknown }[]): Promise<void>;

  /**
   * Remove a key.
   */
  remove(key: StorageKey): Promise<void>;

  /**
   * Remove several keys at once.
   */
  removeMany(keys: StorageKey[]): Promise<void>;

  /**
   * Observe a key. The callback receives the new value (null when removed).
   * @returns A function that stops watching.
   */
  watch<T = unknown>(key: StorageKey, callback: (value: T | null) => void): () => void;
}
