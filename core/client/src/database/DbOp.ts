import { DEFAULT_VAULT_MUTATION_SCOPE } from '../sync/VaultMutationScope';

import type { IDatabaseClient, ISyncDatabaseClient, SqliteBindValue } from './BaseRepository';
import type { VaultMutationScope } from '../sync/VaultMutationScope';

/*
 * Repository methods are written once and can run on two kinds of host: synchronous and 
 * asynchronous (mobile native vault store).
 */

/**
 * One database step a DbOp asks its host to perform.
 */
export type DbEffect =
  | { kind: 'query'; sql: string; params: SqliteBindValue[] }
  | { kind: 'execute'; sql: string; params: SqliteBindValue[] }
  | { kind: 'personalManifestId' };

/**
 * A database operation that can run both synchronously and asynchronously.
 */
export type DbOp<T> = Generator<DbEffect, T, unknown>;

/**
 * A repository that can be told which mutation scope its writes belong to (every BaseRepository can).
 */
type ScopedRepository = {
  setMutationScope?(scope: VaultMutationScope): void;
};

/**
 * A repository as a synchronous host sees it: DbOp methods return their value, everything else is unchanged.
 */
export type SyncRepository<R> = {
  [K in keyof R]: R[K] extends (...args: infer A) => DbOp<infer T> ? (...args: A) => T : R[K];
};

/**
 * A repository as an asynchronous host sees it: DbOp methods return a Promise, everything else is unchanged.
 */
export type AsyncRepository<R> = {
  [K in keyof R]: R[K] extends (...args: infer A) => DbOp<infer T> ? (...args: A) => Promise<T> : R[K];
};

/**
 * Run an op to completion on a synchronous client. An op that writes records its scope on the client; a
 * read-only op records nothing.
 * @param op - The op to run
 * @param client - The client that performs its steps
 * @param scope - What the op's writes touch. Defaults to a full-manifest change.
 * @returns The op's result
 */
export function runSync<T>(op: DbOp<T>, client: ISyncDatabaseClient, scope?: VaultMutationScope): T {
  let wrote = false;
  try {
    let step = op.next();
    while (!step.done) {
      let result: unknown;
      try {
        if (step.value.kind === 'execute') {
          wrote = true;
        }
        result = performSync(step.value, client);
      } catch (error) {
        step = op.throw(error);
        continue;
      }
      step = op.next(result);
    }
    return step.value;
  } finally {
    /*
     * Recorded even when the op threw. The synchronous path runs no transaction of its own, so a write that
     * already happened stays in the database and still has to reach the server.
     */
    if (wrote) {
      client.recordMutationScope?.(scope ?? DEFAULT_VAULT_MUTATION_SCOPE);
    }
  }
}

/**
 * Run an op to completion on any client, awaiting each step. On a client that persists on commit, an op that writes
 * outside a transaction runs in one of its own.
 * @param op - The op to run
 * @param client - The client that performs its steps
 * @param scope - What the op's writes touch, for a host that marks the vault dirty per scope
 * @returns The op's result
 */
export async function runAsync<T>(op: DbOp<T>, client: IDatabaseClient, scope?: VaultMutationScope): Promise<T> {
  let ownsTransaction = false;
  let wrote = false;
  try {
    let step = op.next();
    while (!step.done) {
      let result: unknown;
      try {
        if (step.value.kind === 'execute') {
          wrote = true;
          if (client.persistsOnCommit && !ownsTransaction && !client.isInTransaction()) {
            await client.beginTransaction();
            ownsTransaction = true;
          }
        }
        result = await performAsync(step.value, client);
      } catch (error) {
        step = op.throw(error);
        continue;
      }
      step = op.next(result);
    }

    if (ownsTransaction) {
      await client.commitTransaction(scope);
      ownsTransaction = false;
    }
    return step.value;
  } catch (error) {
    if (ownsTransaction) {
      try {
        await client.rollbackTransaction();
      } catch {
        // The original error is the one worth reporting.
      }
    }
    throw error;
  } finally {
    // Only a client that persists nothing per write records here; one that persists on commit got the scope there.
    if (wrote) {
      client.recordMutationScope?.(scope ?? DEFAULT_VAULT_MUTATION_SCOPE);
    }
  }
}

/**
 * Wrap a repository for a synchronous client.
 * @param repository - The repository
 * @param client - The client its ops run on
 * @param scope - What this repository's writes touch; a bucket-scoped repository lets the sync push just that
 * data bucket instead of the full vault manifest. Defaults to a full-manifest change.
 * @returns The repository with its DbOp methods returning plain values
 */
export function syncRepository<R extends object>(repository: R, client: ISyncDatabaseClient, scope?: VaultMutationScope): SyncRepository<R> {
  return bindRepository(scopeRepository(repository, scope), (op) => runSync(op, client, scope)) as SyncRepository<R>;
}

/**
 * Wrap a repository for an asynchronous client.
 * @param repository - The repository
 * @param client - The client its ops run on
 * @param scope - What this repository's writes touch; a bucket-scoped repository lets the sync push just that
 * data bucket instead of the full vault manifest. Defaults to a full-manifest change.
 * @returns The repository with its DbOp methods returning Promises
 */
export function asyncRepository<R extends object>(repository: R, client: IDatabaseClient, scope?: VaultMutationScope): AsyncRepository<R> {
  return bindRepository(scopeRepository(repository, scope), (op) => runAsync(op, client, scope)) as AsyncRepository<R>;
}

/**
 * Tell a repository which scope its writes belong to, so the methods it runs itself (the async ones, which
 * never pass through the wrapper below) report the same scope as the ops the wrapper runs.
 * @param repository - The repository
 * @param scope - The scope, or undefined to leave the repository on its default
 * @returns The same repository
 */
function scopeRepository<R extends object>(repository: R, scope?: VaultMutationScope): R {
  if (scope) {
    (repository as ScopedRepository).setMutationScope?.(scope);
  }
  return repository;
}

/**
 * Perform one step on a synchronous client.
 * @param effect - The step
 * @param client - The client
 * @returns The step's result
 */
function performSync(effect: DbEffect, client: ISyncDatabaseClient): unknown {
  switch (effect.kind) {
    case 'query':
      return client.executeQuery(effect.sql, effect.params);
    case 'execute':
      return client.executeUpdate(effect.sql, effect.params);
    case 'personalManifestId':
      return client.getPersonalManifestId();
  }
}

/**
 * Perform one step on any client.
 * @param effect - The step
 * @param client - The client
 * @returns The step's result
 */
async function performAsync(effect: DbEffect, client: IDatabaseClient): Promise<unknown> {
  switch (effect.kind) {
    case 'query':
      return client.executeQuery(effect.sql, effect.params);
    case 'execute':
      return client.executeUpdate(effect.sql, effect.params);
    case 'personalManifestId':
      return client.getPersonalManifestId();
  }
}

/**
 * Put a repository behind a Proxy that runs every DbOp its methods return, and passes any other result through.
 * @param repository - The repository
 * @param run - How to run an op
 * @returns The proxied repository
 */
function bindRepository<R extends object>(repository: R, run: (op: DbOp<unknown>) => unknown): R {
  // One wrapper per method, so a method read twice is the same function (stable for React dependency lists).
  const wrappers = new Map<PropertyKey, (...args: unknown[]) => unknown>();

  return new Proxy(repository, {
    /**
     * Resolve a member, wrapping methods.
     */
    get: (target, property): unknown => {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') {
        return value;
      }

      let wrapper = wrappers.get(property);
      if (!wrapper) {
        const method = value as (...args: unknown[]) => unknown;
        /**
         * Call the method on the repository and run the op it returns.
         */
        wrapper = (...args: unknown[]): unknown => {
          const result = method.apply(target, args);
          return isDbOp(result) ? run(result) : result;
        };
        wrappers.set(property, wrapper);
      }
      return wrapper;
    },
  });
}

/**
 * Whether a value is a generator object, the shape every DbOp has.
 * @param value - The value
 * @returns True for a generator object
 */
function isDbOp(value: unknown): value is DbOp<unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Generator>;
  return typeof candidate.next === 'function' && typeof candidate.throw === 'function' && typeof candidate[Symbol.iterator] === 'function';
}
