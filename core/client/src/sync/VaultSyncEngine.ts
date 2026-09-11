/**
 * The TypeScript interface with the Rust vault sync engine.
 */

import { VaultSqlGenerator } from '@aliasvault/vault';

import { CapabilityService } from '../api/CapabilityService';
import { NetworkError } from '../api/errors/NetworkError';
import { RequestTimeoutError } from '../api/errors/RequestTimeoutError';
import { WebApiService } from '../api/WebApiService';
import { StorageKeys } from '../constants/StorageKeys';
import { AppInfo } from '../platform/AppInfo';
import { getPlatform } from '../platform/ClientPlatform';
import { devLog, devWarn } from '../platform/Logger';
import { TranslatableMessage } from '../platform/TranslatableMessage';
import { rustCore } from '../rust/RustCore';
import { base64ToBytes, bytesToBase64 } from '../utilities/Base64';

import { getDirtyScopes } from './VaultDirtyState';

import type { StorageKey } from '../platform/KeyValueStore';
import type { ISqliteDatabase, SqliteValue } from '../platform/SqliteEngine';

/** The operations the engine runs. */
export type VaultSyncOperation = 'fullSync' | 'migrationStatus' | 'migrateManifest' | 'statusCheck';

/** What the host hands the engine at session start (the Rust `SyncRequest`). */
export type VaultSyncEngineRequest = {
  operation: VaultSyncOperation;
  username: string;
  encryptionKey?: string;
  accountPublicKey?: string;
  accountPrivateKey?: string;
  isDirty: boolean;
  mutationSequence: number;
  dirtyScopes: string[];
  privateEmailDomains: string[];
  forcePull: boolean;
  minServerVersion: string;
  isOfflineMode: boolean;
  unnamedSharedVaultName: string;
};

/** Session values the engine changed and the host has to adopt. */
export type VaultSyncSessionUpdates = {
  encryptionKey?: string;
  accountPrivateKey?: string;
  clearAccountPrivateKey?: boolean;
};

/** The email routing a pulled vault came with. */
export type VaultSyncEmailRouting = {
  emailAddressList: string[];
  privateEmailDomainList: string[];
  hiddenPrivateEmailDomainList: string[];
  publicEmailDomainList: string[];
};

/** What every engine result carries. */
type EngineResultBase = {
  sessionUpdates: VaultSyncSessionUpdates;
  vaultChanged: boolean;
};

/** Outcome of a full sync (the Rust `SyncResult`). */
export type VaultSyncEngineResult = EngineResultBase & {
  success: boolean;
  hasNewVault: boolean;
  wasOffline: boolean;
  sqliteBlobUpgradeRequired: boolean;
  manifestMigrationRequired: boolean;
  error?: string;
  errorCode?: string;
  errorKey?: string;
  requiresLogout: boolean;
  serverVersion?: string;
  capabilities?: Record<string, string>;
  isOfflineMode: boolean;
  pulledRevision?: number;
  emailRouting?: VaultSyncEmailRouting;
};

/** Outcome of the migration classification. */
export type VaultSyncMigrationStatusResult = EngineResultBase & {
  kind: 'none' | 'schema-rebuild' | 'storage-format-upgrade';
  serverConfirmed: boolean;
};

/** Outcome of the manifest migration. */
export type VaultSyncMigrateManifestResult = EngineResultBase & {
  success: boolean;
  pushed: boolean;
  error?: string;
  errorCode?: string;
  errorKey?: string;
  requiresLogout: boolean;
};

/** Outcome of the lightweight status check. */
export type VaultSyncStatusCheckResult = EngineResultBase & {
  success: boolean;
  hasNewerVault: boolean;
  hasDirtyChanges: boolean;
  isOffline: boolean;
  requiresLogout: boolean;
  errorKey?: string;
  error?: string;
  errorCode?: string;
  serverVersion?: string;
  capabilities?: Record<string, string>;
};

/** What the engine asks to persist as the at-rest vault blob. */
export type VaultSyncStoreRequest = {
  encryptedBlob: string;
  markDirty: boolean;
  expectedMutationSeq?: number;
  revision?: number;
};

/** Outcome of a store: refused when the expected mutation sequence no longer matched. */
export type VaultSyncStoreOutcome = {
  success: boolean;
  mutationSequence: number;
};

/** What a running sync is doing: downloading a newer server vault, or uploading local changes. */
export type VaultSyncPhase = 'pull' | 'push';

/**
 * The engine's host interface.
 */
export interface IVaultSyncEngineHost {
  /**
   * The open local vault.
   */
  localDatabase(): Promise<ISqliteDatabase>;

  /**
   * The at-rest vault blob, or null when none is stored.
   */
  loadVault(): Promise<string | null>;

  /**
   * Persist the at-rest vault blob.
   */
  storeVault(request: VaultSyncStoreRequest): Promise<VaultSyncStoreOutcome>;

  /**
   * Clear the dirty flag unless a local mutation happened since the given sequence.
   */
  markClean(mutationSeqAtStart: number): Promise<boolean>;

  /**
   * Called when the run ends with changes written to the local database that no store persisted, so the host can
   * drop its in-memory copy and reload the stored vault.
   */
  discardLocalDatabase?(): void;

  /**
   * Called when the engine has decided what the sync is about to do.
   */
  onPhase?(phase: VaultSyncPhase): void;
}

/** A JSON value as the engine exchanges it. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** One parameterized statement of a `dbExec` command. */
type EngineSqlStatement = { sql: string; params?: JsonValue[] };

/** The engine's commands; see the Rust `Command` enum. */
type EngineCommand =
  | { kind: 'http'; method: string; path: string; body?: string; auth: boolean; largeTransfer: boolean }
  | { kind: 'stateGet'; key: string }
  | { kind: 'stateSet'; key: string; value: JsonValue }
  | { kind: 'stateRemove'; key: string }
  | { kind: 'dbOpen'; db: string; bytes?: string | null }
  | { kind: 'dbQuery'; db: string; sql: string; params: JsonValue[] }
  | { kind: 'dbExec'; db: string; statements: EngineSqlStatement[] }
  | { kind: 'dbExport'; db: string }
  | { kind: 'vaultStore'; encryptedBlob: string; markDirty: boolean; encryptionKey?: string; expectedMutationSeq?: number; revision?: number }
  | { kind: 'vaultLoad' }
  | { kind: 'markClean'; mutationSeqAtStart: number }
  | { kind: 'log'; level: 'log' | 'warn' | 'phase'; message: string }
  | { kind: 'done'; result: JsonValue };

/** The database names a command may address. */
const DB_LOCAL = 'local';
const DB_STAGING = 'staging';

/**
 * A cell as the engine binds it: `{ __b64 }` binds a BLOB, booleans bind as integers, objects as their JSON.
 * @param value - the JSON parameter
 */
function toBindValue(value: JsonValue | undefined): SqliteValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (!Array.isArray(value) && typeof value.__b64 === 'string') {
    return base64ToBytes(value.__b64);
  }
  return JSON.stringify(value);
}

/**
 * A cell as the engine reads it: BLOB columns travel as `{ __b64 }`.
 * @param value - the SQLite value
 */
function toJsonCell(value: SqliteValue): JsonValue {
  return value instanceof Uint8Array ? { __b64: bytesToBase64(value) } : value;
}

/**
 * Run statements inside one transaction, rolling back when any fails.
 * @param db - the database
 * @param statements - the statements
 */
function execInTransaction(db: ISqliteDatabase, statements: EngineSqlStatement[]): void {
  db.exec('BEGIN');
  try {
    for (const statement of statements) {
      db.run(statement.sql, (statement.params ?? []).map(toBindValue));
    }
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // The transaction is already gone; the original error is what matters.
    }
    throw error;
  }
}

/**
 * The storage key of an engine state key.
 * @param key - the engine's key
 */
function stateKey(key: string): StorageKey {
  if (key.includes(':')) {
    throw new Error(`The sync engine addressed a prefixed state key: ${key}`);
  }
  return `local:${key}` as StorageKey;
}

/** The SQLite bytes of a fresh database on the current client schema. */
let freshSchemaBytes: Promise<Uint8Array> | null = null;

/**
 * A fresh database on the current client schema.
 */
async function openFreshSchemaDatabase(): Promise<ISqliteDatabase> {
  freshSchemaBytes ??= (async (): Promise<Uint8Array> => {
    const db = await getPlatform().sqlite.open();
    try {
      db.exec(new VaultSqlGenerator().getCompleteSchemaSql());
      return db.export();
    } finally {
      db.close();
    }
  })().catch((error: unknown) => {
    freshSchemaBytes = null;
    throw error;
  });
  return getPlatform().sqlite.open(await freshSchemaBytes);
}

/**
 * Current time in milliseconds.
 */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Carries out one engine run's commands.
 */
class EngineRun {
  private staging: ISqliteDatabase | null = null;

  /** The open local vault. */
  private local: ISqliteDatabase | null = null;

  /** Whether the local database was written to since the last store. */
  private localMutated = false;

  /** Time spent in the host per command kind (for debugging). */
  private readonly timings = new Map<string, { count: number; ms: number }>();

  /**
   * Create a run.
   * @param host - the host
   * @param webApi - the API the HTTP commands run on
   */
  public constructor(private readonly host: IVaultSyncEngineHost, private readonly webApi: WebApiService) {}

  /**
   * Carry out one command.
   * @param command - the command
   */
  public async handle(command: Exclude<EngineCommand, { kind: 'done' }>): Promise<JsonValue> {
    const started = now();
    try {
      return await this.dispatch(command);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    } finally {
      const timing = this.timings.get(command.kind) ?? { count: 0, ms: 0 };
      timing.count++;
      timing.ms += now() - started;
      this.timings.set(command.kind, timing);
    }
  }

  /**
   * One line of where the time went.
   * @param operation - the operation that ran
   * @param totalMs - the run's wall time
   */
  public summarize(operation: string, totalMs: number): string {
    let hostMs = 0;
    const parts: string[] = [];
    for (const [kind, timing] of [...this.timings.entries()].sort((a, b) => b[1].ms - a[1].ms)) {
      hostMs += timing.ms;
      parts.push(`${kind} ${timing.count}x ${timing.ms.toFixed(0)}ms`);
    }
    return `[VaultSyncEngine] ${operation} took ${totalMs.toFixed(0)}ms: engine ${(totalMs - hostMs).toFixed(0)}ms, host ${hostMs.toFixed(0)}ms (${parts.join(', ')})`;
  }

  /**
   * Release the staging database.
   */
  public close(): void {
    this.staging?.close();
    this.staging = null;
    if (this.localMutated) {
      this.host.discardLocalDatabase?.();
    }
  }

  /**
   * The command handlers.
   * @param command - the command
   */
  private async dispatch(command: Exclude<EngineCommand, { kind: 'done' }>): Promise<JsonValue> {
    switch (command.kind) {
      case 'http':
        return this.http(command);
      case 'stateGet':
        return { value: await getPlatform().storage.get<JsonValue>(stateKey(command.key)) };
      case 'stateSet':
        await getPlatform().storage.set(stateKey(command.key), command.value);
        return {};
      case 'stateRemove':
        await getPlatform().storage.remove(stateKey(command.key));
        return {};
      case 'dbOpen':
        await this.openStaging(command.bytes ?? null);
        return {};
      case 'dbQuery': {
        const rows = (await this.database(command.db)).query(command.sql, command.params.map(toBindValue));
        return { rows: rows.map(row => Object.fromEntries(Object.entries(row).map(([column, value]) => [column, toJsonCell(value)]))) };
      }
      case 'dbExec':
        execInTransaction(await this.database(command.db), command.statements);
        if (command.db === DB_LOCAL) {
          this.localMutated = true;
        }
        return {};
      case 'dbExport':
        return { bytes: bytesToBase64((await this.database(command.db)).export()) };
      case 'vaultStore':
        return this.storeVault(command);
      case 'vaultLoad':
        return { encryptedBlob: await this.host.loadVault() };
      case 'markClean':
        return { cleared: await this.host.markClean(command.mutationSeqAtStart) };
      case 'log':
        this.log(command.level, command.message);
        return {};
      default:
        throw new Error(`Unknown engine command ${(command as { kind: string }).kind}`);
    }
  }

  /**
   * An API request.
   * @param command - the command
   */
  private async http(command: Extract<EngineCommand, { kind: 'http' }>): Promise<JsonValue> {
    try {
      const response = await this.webApi.engineRequest(command.method, command.path, command.body, command.auth, command.largeTransfer);
      return { status: response.status, body: response.body };
    } catch (error) {
      if (error instanceof NetworkError) {
        return { status: 0, transportError: error.message, timedOut: error instanceof RequestTimeoutError };
      }
      throw error;
    }
  }

  /**
   * Adopt the key a re-encrypted blob is under, then persist the blob.
   * @param command - the command
   */
  private async storeVault(command: Extract<EngineCommand, { kind: 'vaultStore' }>): Promise<JsonValue> {
    if (command.encryptionKey) {
      await getPlatform().storage.set(StorageKeys.ENCRYPTION_KEY, command.encryptionKey);
    }
    const outcome = await this.host.storeVault({
      encryptedBlob: command.encryptedBlob,
      markDirty: command.markDirty,
      expectedMutationSeq: command.expectedMutationSeq,
      revision: command.revision,
    });
    if (outcome.success) {
      // The local database is now the vault just stored; the host serves it on the next request.
      this.localMutated = false;
      this.local = null;
    }
    return { success: outcome.success, mutationSequence: outcome.mutationSequence };
  }

  /**
   * The database a command addresses.
   * @param name - `local` or `staging`
   */
  private async database(name: string): Promise<ISqliteDatabase> {
    if (name === DB_LOCAL) {
      this.local ??= await this.host.localDatabase();
      return this.local;
    }
    if (name === DB_STAGING) {
      if (!this.staging) {
        throw new Error('The staging database is not open');
      }
      return this.staging;
    }
    throw new Error(`Unknown database ${name}`);
  }

  /**
   * Open the staging database.
   * @param bytesBase64 - the SQLite file bytes, or null for a fresh database
   */
  private async openStaging(bytesBase64: string | null): Promise<void> {
    this.staging?.close();
    this.staging = null;
    const db = bytesBase64 ? await getPlatform().sqlite.open(base64ToBytes(bytesBase64)) : await openFreshSchemaDatabase();
    try {
      db.exec('PRAGMA foreign_keys = OFF');
    } catch (error) {
      db.close();
      throw error;
    }
    this.staging = db;
  }

  /**
   * Route an engine log line.
   * @param level - the level
   * @param message - the message
   */
  private log(level: string, message: string): void {
    switch (level) {
      case 'phase':
        this.host.onPhase?.(message as VaultSyncPhase);
        break;
      case 'warn':
        devWarn(message);
        break;
      default:
        devLog(message);
    }
  }
}

/**
 * Run one engine operation.
 * @param host - the host
 * @param request - the request
 * @param webApi - the API the HTTP commands run on
 */
export async function runVaultSyncEngine<T extends EngineResultBase>(host: IVaultSyncEngineHost, request: VaultSyncEngineRequest, webApi: WebApiService = new WebApiService()): Promise<T> {
  const started = now();
  const session = await rustCore().createVaultSyncSession(JSON.stringify(request));
  const run = new EngineRun(host, webApi);
  try {
    for (;;) {
      const command = JSON.parse(await session.nextCommand()) as EngineCommand;
      if (command.kind === 'done') {
        const result = command.result as T;
        await applySessionUpdates(result.sessionUpdates);
        devLog(run.summarize(request.operation, now() - started));
        return result;
      }
      await session.resume(JSON.stringify(await run.handle(command)));
    }
  } finally {
    run.close();
    session.free();
  }
}

/**
 * Adopt the session values the engine changed.
 * @param updates - the updates
 */
async function applySessionUpdates(updates: VaultSyncSessionUpdates | undefined): Promise<void> {
  if (!updates) {
    return;
  }
  const storage = getPlatform().storage;
  if (updates.encryptionKey) {
    await storage.set(StorageKeys.ENCRYPTION_KEY, updates.encryptionKey);
  }
  if (updates.accountPrivateKey) {
    await storage.set(StorageKeys.ACCOUNT_PRIVATE_KEY, updates.accountPrivateKey);
  } else if (updates.clearAccountPrivateKey) {
    await storage.remove(StorageKeys.ACCOUNT_PRIVATE_KEY);
  }
}

/** What a caller may ask of a full sync beyond what the revisions decide. */
export type VaultSyncOptions = {
  forcePull?: boolean;
};

/**
 * Build the engine request from the session state in the platform storage.
 * @param operation - the operation
 * @param options - what the caller asks beyond what the engine decides
 */
export async function buildVaultSyncRequest(operation: VaultSyncOperation, options: VaultSyncOptions = {}): Promise<VaultSyncEngineRequest> {
  const storage = getPlatform().storage;
  const [username, encryptionKey, accountPublicKey, accountPrivateKey, isDirty, mutationSequence, privateEmailDomains, isOfflineMode] = await Promise.all([
    storage.get<string>(StorageKeys.USERNAME),
    storage.get<string>(StorageKeys.ENCRYPTION_KEY),
    storage.get<string>(StorageKeys.ACCOUNT_PUBLIC_KEY),
    storage.get<string>(StorageKeys.ACCOUNT_PRIVATE_KEY),
    storage.get<boolean>(StorageKeys.IS_DIRTY),
    storage.get<number>(StorageKeys.MUTATION_SEQUENCE),
    storage.get<string[]>(StorageKeys.PRIVATE_EMAIL_DOMAINS),
    storage.get<boolean>(StorageKeys.IS_OFFLINE_MODE),
  ]);

  return {
    operation,
    username: username ?? '',
    encryptionKey: encryptionKey ?? undefined,
    accountPublicKey: accountPublicKey ?? undefined,
    accountPrivateKey: accountPrivateKey ?? undefined,
    isDirty: isDirty ?? false,
    mutationSequence: mutationSequence ?? 0,
    dirtyScopes: isDirty ? await getDirtyScopes() : [],
    privateEmailDomains: privateEmailDomains ?? [],
    forcePull: options.forcePull === true,
    minServerVersion: AppInfo.MIN_SERVER_VERSION,
    isOfflineMode: isOfflineMode ?? false,
    unnamedSharedVaultName: await getPlatform().translate(TranslatableMessage.UnnamedSharedVault),
  };
}

/**
 * Persist what a status call reported.
 * @param serverVersion - the server version, when the status call reached the server
 * @param capabilities - the resolved capabilities
 */
async function recordServerStatus(serverVersion: string | undefined, capabilities: Record<string, string> | undefined): Promise<void> {
  if (serverVersion && serverVersion !== '0.0.0') {
    await getPlatform().storage.set(StorageKeys.SERVER_VERSION, serverVersion);
  }
  if (capabilities) {
    await CapabilityService.storeCapabilities(capabilities);
  }
}

/**
 * Full vault sync.
 * @param host - the host
 * @param options - what the caller asks beyond what the engine decides
 * @param webApi - the API the HTTP commands run on
 */
export async function runFullVaultSync(host: IVaultSyncEngineHost, options: VaultSyncOptions = {}, webApi?: WebApiService): Promise<VaultSyncEngineResult> {
  const result = await runVaultSyncEngine<VaultSyncEngineResult>(host, await buildVaultSyncRequest('fullSync', options), webApi);
  const storage = getPlatform().storage;

  await recordServerStatus(result.serverVersion, result.capabilities);
  await storage.set(StorageKeys.IS_OFFLINE_MODE, result.isOfflineMode);
  if (result.emailRouting) {
    await storage.setMany([
      { key: StorageKeys.PUBLIC_EMAIL_DOMAINS, value: result.emailRouting.publicEmailDomainList },
      { key: StorageKeys.PRIVATE_EMAIL_DOMAINS, value: result.emailRouting.privateEmailDomainList },
      { key: StorageKeys.HIDDEN_PRIVATE_EMAIL_DOMAINS, value: result.emailRouting.hiddenPrivateEmailDomainList },
    ]);
  }
  return result;
}

/**
 * Run a status check.
 * @param host - the host
 * @param webApi - the API the HTTP commands run on
 */
export async function runVaultStatusCheck(host: IVaultSyncEngineHost, webApi?: WebApiService): Promise<VaultSyncStatusCheckResult> {
  const result = await runVaultSyncEngine<VaultSyncStatusCheckResult>(host, await buildVaultSyncRequest('statusCheck'), webApi);
  await recordServerStatus(result.serverVersion, result.capabilities);
  return result;
}

/**
 * Classify the pending local migration.
 * @param host - the host
 */
export function runVaultMigrationStatus(host: IVaultSyncEngineHost): Promise<VaultSyncMigrationStatusResult> {
  return buildVaultSyncRequest('migrationStatus').then(request => runVaultSyncEngine<VaultSyncMigrationStatusResult>(host, request));
}

/**
 * Run the local storage-model migration (schema rebuild and/or account key hierarchy) and push it.
 * @param host - the host
 */
export function runVaultManifestMigration(host: IVaultSyncEngineHost): Promise<VaultSyncMigrateManifestResult> {
  return buildVaultSyncRequest('migrateManifest').then(request => runVaultSyncEngine<VaultSyncMigrateManifestResult>(host, request));
}
