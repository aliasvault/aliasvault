/**
 * The web app's platform storage:
 *  - `local:` keys live in IndexedDB (the encrypted vault can exceed the localStorage quota)
 *  - `session:` keys live in memory only so the decrypted vault key is never persisted on disk.
 */

import type { IKeyValueStore, StorageKey } from '@aliasvault/client/platform';

const DB_NAME = 'aliasvault-web';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const CHANNEL_NAME = 'aliasvault-web-storage';

type Listener = (value: unknown) => void;

/**
 * A change another tab broadcast.
 */
type StorageChangeMessage = {
  key: string;
  value: unknown;
};

/**
 * Wrap an IndexedDB request in a promise.
 * @param request - the request
 */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')));
  });
}

/**
 * Wait for a transaction to complete.
 * @param transaction - the transaction
 */
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed')));
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')));
  });
}

/**
 * The platform key-value store.
 */
export class WebKeyValueStore implements IKeyValueStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly session = new Map<string, unknown>();
  private readonly watchers = new Map<string, Set<Listener>>();
  private readonly channel: BroadcastChannel | null;

  /**
   * Create the store and start listening for changes other tabs make.
   */
  public constructor() {
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
    this.channel?.addEventListener('message', (event: MessageEvent<StorageChangeMessage>) => {
      this.notify(event.data.key, event.data.value);
    });
  }

  /** @inheritdoc */
  public async get<T = unknown>(key: StorageKey): Promise<T | null> {
    if (key.startsWith('session:')) {
      return (this.session.get(key) as T | undefined) ?? null;
    }
    const db = await this.open();
    const value = await requestToPromise(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key));
    return (value as T | undefined) ?? null;
  }

  /** @inheritdoc */
  public async set(key: StorageKey, value: unknown): Promise<void> {
    await this.setMany([{ key, value }]);
  }

  /** @inheritdoc */
  public async setMany(entries: { key: StorageKey; value: unknown }[]): Promise<void> {
    const persisted = entries.filter(entry => !entry.key.startsWith('session:'));
    for (const entry of entries) {
      if (entry.key.startsWith('session:')) {
        this.session.set(entry.key, entry.value);
      }
    }
    if (persisted.length > 0) {
      const db = await this.open();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      for (const entry of persisted) {
        store.put(entry.value, entry.key);
      }
      await transactionDone(transaction);
    }
    for (const entry of entries) {
      this.notify(entry.key, entry.value);
      if (!entry.key.startsWith('session:')) {
        this.broadcast(entry.key, entry.value);
      }
    }
  }

  /** @inheritdoc */
  public async remove(key: StorageKey): Promise<void> {
    await this.removeMany([key]);
  }

  /** @inheritdoc */
  public async removeMany(keys: StorageKey[]): Promise<void> {
    const persisted = keys.filter(key => !key.startsWith('session:'));
    for (const key of keys) {
      if (key.startsWith('session:')) {
        this.session.delete(key);
      }
    }
    if (persisted.length > 0) {
      const db = await this.open();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      for (const key of persisted) {
        store.delete(key);
      }
      await transactionDone(transaction);
    }
    for (const key of keys) {
      this.notify(key, null);
      if (!key.startsWith('session:')) {
        this.broadcast(key, null);
      }
    }
  }

  /** @inheritdoc */
  public watch<T = unknown>(key: StorageKey, callback: (value: T | null) => void): () => void {
    const listeners = this.watchers.get(key) ?? new Set<Listener>();
    /**
     * Forward a stored value to the caller's typed callback.
     */
    const listener: Listener = (value: unknown): void => callback((value as T | null) ?? null);
    listeners.add(listener);
    this.watchers.set(key, listeners);
    return (): void => {
      listeners.delete(listener);
    };
  }

  /**
   * Open (and on first use create) the database.
   */
  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.addEventListener('upgradeneeded', () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      });
      request.addEventListener('success', () => resolve(request.result));
      request.addEventListener('error', () => {
        this.dbPromise = null;
        reject(request.error ?? new Error('Could not open IndexedDB'));
      });
    });
    return this.dbPromise;
  }

  /**
   * Notify this tab's watchers of a key.
   * @param key - the key
   * @param value - the new value, null when removed
   */
  private notify(key: string, value: unknown): void {
    this.watchers.get(key)?.forEach(listener => listener(value));
  }

  /**
   * Tell the other tabs about a change to a persisted key.
   * @param key - the key
   * @param value - the new value, null when removed
   */
  private broadcast(key: string, value: unknown): void {
    try {
      this.channel?.postMessage({ key, value } satisfies StorageChangeMessage);
    } catch {
      // A value that cannot be cloned (should not happen for JSON data) is not worth failing the write for.
    }
  }
}
