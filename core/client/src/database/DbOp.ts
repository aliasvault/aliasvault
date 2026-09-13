import type { IDatabaseClient, ISyncDatabaseClient, SqliteBindValue } from './BaseRepository';

/*
 * Repository methods are written once and can run on two kinds of host: synchronous (sql.js) and 
 * asynchronous (mobile native vault store).
 */

/**
 * The active and personal manifest ids of the client an op runs on.
 */
export type ManifestScope = {
  active: string | null;
  personal: string | null;
};

/**
 * One database step a DbOp asks its host to perform.
 */
export type DbEffect =
  | { kind: 'query'; sql: string; params: SqliteBindValue[] }
  | { kind: 'execute'; sql: string; params: SqliteBindValue[] }
  | { kind: 'manifestScope' };

/**
 * A database operation that runs synchronously on sql.js and asynchronously over a native bridge.
 */
export type DbOp<T> = Generator<DbEffect, T, unknown>;

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
 * Run an op to completion on a synchronous client.
 * @param op - The op to run
 * @param client - The client that performs its steps
 * @returns The op's result
 */
export function runSync<T>(op: DbOp<T>, client: ISyncDatabaseClient): T {
  let step = op.next();
  while (!step.done) {
    let result: unknown;
    try {
      result = performSync(step.value, client);
    } catch (error) {
      step = op.throw(error);
      continue;
    }
    step = op.next(result);
  }
  return step.value;
}

/**
 * Run an op to completion on any client, awaiting each step. On a client that persists on commit, an op that writes
 * outside a transaction runs in one of its own.
 * @param op - The op to run
 * @param client - The client that performs its steps
 * @returns The op's result
 */
export async function runAsync<T>(op: DbOp<T>, client: IDatabaseClient): Promise<T> {
  let ownsTransaction = false;
  try {
    let step = op.next();
    while (!step.done) {
      let result: unknown;
      try {
        if (client.persistsOnCommit && step.value.kind === 'execute' && !ownsTransaction && !client.isInTransaction()) {
          await client.beginTransaction();
          ownsTransaction = true;
        }
        result = await performAsync(step.value, client);
      } catch (error) {
        step = op.throw(error);
        continue;
      }
      step = op.next(result);
    }

    if (ownsTransaction) {
      await client.commitTransaction();
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
  }
}

/**
 * Wrap a repository for a synchronous client.
 * @param repository - The repository
 * @param client - The client its ops run on
 * @returns The repository with its DbOp methods returning plain values
 */
export function syncRepository<R extends object>(repository: R, client: ISyncDatabaseClient): SyncRepository<R> {
  return bindRepository(repository, (op) => runSync(op, client)) as SyncRepository<R>;
}

/**
 * Wrap a repository for an asynchronous client.
 * @param repository - The repository
 * @param client - The client its ops run on
 * @returns The repository with its DbOp methods returning Promises
 */
export function asyncRepository<R extends object>(repository: R, client: IDatabaseClient): AsyncRepository<R> {
  return bindRepository(repository, (op) => runAsync(op, client)) as AsyncRepository<R>;
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
    case 'manifestScope':
      return { active: client.getActiveManifestId(), personal: client.getPersonalManifestId() } satisfies ManifestScope;
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
    case 'manifestScope':
      return { active: client.getActiveManifestId(), personal: await client.getPersonalManifestId() } satisfies ManifestScope;
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
