/* eslint-disable @typescript-eslint/no-explicit-any */
import { storage } from 'wxt/utils/storage';

import { base64ToBytes } from '@/utils/Base64';
import { AUTH_STORAGE_KEYS, dirtyScopeStorageKey, SESSION_STORAGE_KEYS, StorageKeys, vaultDataStorageKeys, VAULT_LOCK_STORAGE_KEYS } from '@/utils/constants/storageKeys';
import { TRASH_RETENTION_DAYS } from '@/utils/constants/vault';
import type { ItemUsageAction } from '@/utils/db';
import type { DraftItem } from '@/utils/db/ItemRef';
import { devError, devLog, devWarn } from '@/utils/devLogger/DevLogger';
import type { EncryptionKeyDerivationParams } from '@/utils/dist/core/models/metadata';
import { FieldKey, ItemTypes, VaultDataBucketCategory, createSystemField, type Item, type PasswordSettings } from '@/utils/dist/core/models/vault';
import { VaultKeyAlgorithm, type VaultResponse, type ManifestRevision, type StatusResponseV2 } from '@/utils/dist/core/models/webapi';
import { EncryptionUtility } from '@/utils/EncryptionUtility';
import { readLegacySessionEncryptionKey } from '@/utils/legacy/LegacyStorageKeyFallbacks';
import { requiresLegacyAccountKeyMigration } from '@/utils/legacy/LegacyStorageModelMigration';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { getManifestRevisions, getPersonalManifestId, manifestsRequiringPull, recordManifestRevisions, toManifestRevisionMap } from '@/utils/ManifestRevisions';
import { sendMessage, type TotpSecret } from '@/utils/messaging/ExtensionMessaging';
import { multiManifestRendering } from '@/utils/MultiManifestRendering';
import { PendingActionProcessor } from '@/utils/PendingActionProcessor';
import { RecentlySelectedItemService } from '@/utils/RecentlySelectedItemService';
import { filterItems, AutofillMatchingMode, extractRootDomain, isUrlAlreadyLinked, generatePassword, vaultCodecExtractBuckets, vaultCodecBucketLayout, vaultCodecOverflowTable } from '@/utils/RustCore';
import { ServiceDetectionUtility } from '@/utils/serviceDetection/ServiceDetectionUtility';
import { SharingService } from '@/utils/SharingService';
import { SqliteClient } from '@/utils/SqliteClient';
import { getStorageItem } from '@/utils/StorageUtility';
import { generateTotpCode } from '@/utils/TotpUtility';
import { ApiAuthError } from '@/utils/types/errors/ApiAuthError';
import { ApiRequestError } from '@/utils/types/errors/ApiRequestError';
import { AppErrorCode, formatErrorWithCode } from '@/utils/types/errors/AppErrorCodes';
import { ClientUpgradeRequiredError } from '@/utils/types/errors/ClientUpgradeRequiredError';
import { NetworkError } from '@/utils/types/errors/NetworkError';
import { PayloadTooLargeError } from '@/utils/types/errors/PayloadTooLargeError';
import { RequestTimeoutError } from '@/utils/types/errors/RequestTimeoutError';
import { ServerUpdateRequiredError } from '@/utils/types/errors/ServerUpdateRequiredError';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionIncompatibleError';
import type { BoolResponse as messageBoolResponse } from '@/utils/types/messaging/BoolResponse';
import type { DuplicateCheckResponse } from '@/utils/types/messaging/DuplicateCheckResponse';
import type { IdentitySettingsResponse } from '@/utils/types/messaging/IdentitySettingsResponse';
import type { ItemsResponse as messageItemsResponse } from '@/utils/types/messaging/ItemsResponse';
import type { PasswordSettingsResponse as messagePasswordSettingsResponse } from '@/utils/types/messaging/PasswordSettingsResponse';
import type { SaveLoginResponse } from '@/utils/types/messaging/SaveLoginResponse';
import type { StringResponse as stringResponse } from '@/utils/types/messaging/StringResponse';
import type { VaultResponse as messageVaultResponse } from '@/utils/types/messaging/VaultResponse';
import type { VaultUploadResponse as messageVaultUploadResponse } from '@/utils/types/messaging/VaultUploadResponse';
import { type VaultMutationScope, DEFAULT_VAULT_MUTATION_SCOPE, hasUserVisibleScope, isManifestScope } from '@/utils/types/VaultMutationScope';
import { VaultCodec } from '@/utils/VaultCodec';
import { clearDirtyScopes, getDirtyScopes } from '@/utils/VaultDirtyState';
import { VaultKeyService } from '@/utils/VaultKeyService';
import { vaultRequiresManifestMigration, VaultMigrationKind, type VaultMigrationStatus } from '@/utils/VaultManifestMigration';
import { vaultMergeService } from '@/utils/VaultMergeService';
import { vaultSyncService, invalidateCanonicalizeCache } from '@/utils/VaultSyncService';
import { WebApiService } from '@/utils/WebApiService';

import { t } from '@/i18n/StandaloneI18n';

/**
 * Cache for the SqliteClient to avoid repeated decryption and initialization.
 * The cached instance is the single source of truth for the in-memory vault.
 *
 * Cache Strategy:
 * - Local mutations (createCredential, etc.): Work directly on cachedSqliteClient, no cache clearing
 * - New vault from remote (login, sync): Clear cache by setting both to null, WITHOUT closing — an in-flight
 *   flow (e.g. a push holding the client across an HTTP await, or persistLocalVaultMutation re-adopting the
 *   client it just stored) may legitimately still use the detached instance.
 * - Lock/logout/clear vault: cleanupCachedSqliteClient().
 */
let cachedSqliteClient: SqliteClient | null = null;
let cachedVaultBlob: string | null = null;

/**
 * Cleanup the cached decrypted vault database and drop the cache.
 */
function cleanupCachedSqliteClient(): void {
  cachedSqliteClient?.close();
  cachedSqliteClient = null;
  cachedVaultBlob = null;
}

/**
 * Whether the client has to pull and re-materialize, i.e. whether any manifest's local state no longer matches what
 * the server reports.
 * @param serverManifests - the per-manifest revisions from the status response
 * @param localRevisions - the client's last-known revision per manifest
 */
function serverManifestsNeedPull(serverManifests: ManifestRevision[], localRevisions: Record<string, number>): boolean {
  const serverRevisions = toManifestRevisionMap(serverManifests);
  const requiringPull = manifestsRequiringPull(serverRevisions, localRevisions);

  if (requiringPull.length === 0) {
    devLog(`[VaultSync] No pull needed: ${Object.keys(serverRevisions).length} manifest(s) all match local revisions.`);
    return false;
  }

  /** One manifest as `id (local rev X, server rev Y)`, with "untracked"/"unlisted" for a one-sided manifest. */
  const describe = (manifestId: string): string => `${manifestId} (local ${localRevisions[manifestId] ?? 'untracked'}, server ${serverRevisions[manifestId] ?? 'unlisted'})`;
  devLog(`[VaultSync] Pull needed for ${requiringPull.length} manifest(s): ${requiringPull.map(describe).join(', ')}.`);
  return true;
}

/**
 * Global sync queue state.
 * Prevents multiple simultaneous sync operations and ensures pending changes are synced.
 */
let isSyncInProgress = false;
let hasPendingSync = false;

/** The shared manifests a pull was already forced for over a missing key record, so one the server stopped serving does not pull on every sync. */
const manifestsPulledForSharedKeys = new Set<string>();

/**
 * Check if the user is logged in and if the vault is locked, and also check for both kinds of pending vault.
 */
export async function handleCheckAuthStatus() : Promise<{ isLoggedIn: boolean, isVaultLocked: boolean, requiresLegacySqliteBlobMigration: boolean, requiresManifestMigration: boolean, error?: string }> {
  const [username, accessToken, vaultData, encryptionKey] = await Promise.all([storage.getItem(StorageKeys.USERNAME), storage.getItem(StorageKeys.ACCESS_TOKEN), storage.getItem(StorageKeys.ENCRYPTED_VAULT), handleGetEncryptionKey()]);

  const isLoggedIn = username !== null && accessToken !== null;
  const isVaultLocked = isLoggedIn && (vaultData === null || encryptionKey === null);

  // A locked or logged-out vault can't be opened, so neither upgrade state can be determined.
  if (isVaultLocked || !isLoggedIn) {
    return { isLoggedIn, isVaultLocked, requiresLegacySqliteBlobMigration: false, requiresManifestMigration: false };
  }

  // Vault is unlocked, check for pending migrations
  try {
    const sqliteClient = await createVaultSqliteClient();
    const requiresLegacySqliteBlobMigration = await sqliteClient.requiresLegacySqliteBlobMigration();
    const requiresManifestMigration = await vaultRequiresManifestMigration(sqliteClient);
    return { isLoggedIn, isVaultLocked, requiresLegacySqliteBlobMigration, requiresManifestMigration };
  } catch (error) {
    // If it's a version incompatibility error, we need to handle it specially
    if (error instanceof VaultVersionIncompatibleError) {
      // Return the error so the UI can handle it appropriately (logout user)
      return { isLoggedIn, isVaultLocked, requiresLegacySqliteBlobMigration: false, requiresManifestMigration: false, error: error.message };
    }

    return {
      isLoggedIn,
      isVaultLocked,
      requiresLegacySqliteBlobMigration: false,
      requiresManifestMigration: false,
      error: error instanceof Error ? error.message : await t('common.errors.unknownError')
    };
  }
}

/**
 * Store vault metadata (email domains) in browser storage.
 * This is used during login/sync when receiving vault data from the server.
 */
export async function handleStoreVaultMetadata(
  message: {
    publicEmailDomainList?: string[];
    privateEmailDomainList?: string[];
    hiddenPrivateEmailDomainList?: string[];
  },
) : Promise<messageBoolResponse> {
  try {
    if (message.publicEmailDomainList) {
      await storage.setItem(StorageKeys.PUBLIC_EMAIL_DOMAINS, message.publicEmailDomainList);
    }

    if (message.privateEmailDomainList) {
      await storage.setItem(StorageKeys.PRIVATE_EMAIL_DOMAINS, message.privateEmailDomainList);
    }

    if (message.hiddenPrivateEmailDomainList) {
      await storage.setItem(StorageKeys.HIDDEN_PRIVATE_EMAIL_DOMAINS, message.hiddenPrivateEmailDomainList);
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to store vault metadata:', error);
    // E-602: Storage write failed during metadata store
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_WRITE_FAILED) };
  }
}

/**
 * Store the encryption key (derived key) in browser storage.
 */
export async function handleStoreEncryptionKey(
  encryptionKey: string,
) : Promise<messageBoolResponse> {
  try {
    await storage.setItem(StorageKeys.ENCRYPTION_KEY, encryptionKey);
    return { success: true };
  } catch (error) {
    console.error('Failed to store encryption key:', error);
    // E-602: Storage write failed during encryption key store
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownErrorTryAgain'), AppErrorCode.STORAGE_WRITE_FAILED) };
  }
}

/**
 * Store the encryption key derivation parameters in browser storage.
 * These are stored in local: storage to enable offline unlock after browser restart.
 */
export async function handleStoreEncryptionKeyDerivationParams(
  params: EncryptionKeyDerivationParams,
) : Promise<messageBoolResponse> {
  try {
    await storage.setItem(StorageKeys.ENCRYPTION_KEY_DERIVATION_PARAMS, params);
    return { success: true };
  } catch (error) {
    console.error('Failed to store encryption key derivation params:', error);
    // E-602: Storage write failed during derivation params store
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownErrorTryAgain'), AppErrorCode.STORAGE_WRITE_FAILED) };
  }
}

/**
 * Fetch the latest vault from the server as a VaultResponse, via the v2-only {@link VaultSyncService}.
 *
 * GET /v2/Vault returns either the manifest model (materialized locally into a SQLite blob) or, for a
 * not-yet-migrated user, the legacy SQLite blob as-is, so a migrated user never hits the legacy API's 426
 * guard from the sync paths. There is no legacy-API fallback: a server without the v2 API surfaces E-903
 * (update your server).
 */
async function fetchLatestVaultFromServer(): Promise<VaultResponse> {
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    throw new Error(formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
  }

  try {
    return await vaultSyncService.pull(encryptionKey);
  } catch (error) {
    if (error instanceof ServerUpdateRequiredError) {
      throw new Error(formatErrorWithCode(await t('common.errors.serverVersionNotSupported'), AppErrorCode.SERVER_UPDATE_REQUIRED));
    }
    throw error;
  }
}

/**
 * Outcome of a push attempt: 0 = ok, 2 = the server had newer state and the caller must re-sync (pull/merge/retry).
 * Revision bookkeeping happens inside VaultSyncService, which records the new revision of every manifest a
 * successful write actually carried; no revision travels back through this result.
 */
type VaultPushOutcome = { status: number };

/**
 * Push the current SQLite vault to the server.
 *
 * @param sqliteClient - the in-memory SQLite client to upload
 * @param options - forceFullWrite bypasses the content-fingerprint gating and rewrites every manifest and bucket;
 *   createVaultKey mints the VEK as part of this push (KEK/VEK migration)
 */
async function pushVaultToServer(sqliteClient: SqliteClient, options: { forceFullWrite: boolean; createVaultKey: boolean }): Promise<VaultPushOutcome> {
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    throw new Error(formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
  }

  const username = (await storage.getItem(StorageKeys.USERNAME)) as string;

  const result = await vaultSyncService.push(sqliteClient, encryptionKey, username, options);

  if (result.status === 'ok') {
    if (result.newEncryptionKey) {
      /*
       * Migration succeeded: from now on the session key is the VEK, not the password-derived key.
       * TODO: this can be removed once all users have migrated to the manifest-v1 storage model.
       */
      await handleStoreEncryptionKey(result.newEncryptionKey);
    }

    return { status: 0 };
  }

  if (result.status === 'outdated') {
    return { status: 2 };
  }

  if (result.status === 'rejected') {
    // Structural validation error
    const reason = (result.reasons ?? ['Integrity check failed']).join('; ');
    devError('[V2Sync] Refusing to upload corrupt vault:', reason);
    throw new Error(formatErrorWithCode(`Vault integrity check failed: ${reason}`, AppErrorCode.UPLOAD_FAILED));
  }

  /*
   * missing-blobs: push already re-uploaded the blob bytes the server asked for and retried once; landing
   * here means the server still reports gaps, a genuine server-side problem, not a transient race.
   */
  throw new Error(formatErrorWithCode('Server reported missing blobs; please retry', AppErrorCode.UPLOAD_FAILED));
}

/**
 * Sync the vault with the server to check if a newer vault is available. If so, the vault will be updated.
 */
export async function handleSyncVault() : Promise<messageBoolResponse> {
  const webApi = new WebApiService();
  const statusResponse = await webApi.getStatus();
  const statusError = webApi.validateStatusResponse(statusResponse);
  if (statusError !== null) {
    return { success: false, error: await t('common.errors.' + statusError) };
  }

  if (serverManifestsNeedPull(statusResponse.manifestRevisions, await getManifestRevisions())) {
    /*
     * Retrieve the latest vault from the server.
     */
    const vaultResponse = await fetchLatestVaultFromServer();

    // Store in local: storage for persistence (fresh from server, not dirty). The pull recorded the per-manifest revisions itself.
    await storage.setItems([
      { key: StorageKeys.ENCRYPTED_VAULT, value: vaultResponse.vault.blob },
      { key: StorageKeys.PUBLIC_EMAIL_DOMAINS, value: vaultResponse.vault.publicEmailDomainList },
      { key: StorageKeys.PRIVATE_EMAIL_DOMAINS, value: vaultResponse.vault.privateEmailDomainList },
      { key: StorageKeys.HIDDEN_PRIVATE_EMAIL_DOMAINS, value: vaultResponse.vault.hiddenPrivateEmailDomainList },
      { key: StorageKeys.IS_DIRTY, value: false }
    ]);

    // Clear cached client since we received a new vault blob from server
    cachedSqliteClient = null;
    cachedVaultBlob = null;
  }

  return { success: true };
}

/**
 * Get the vault from browser storage (local: for persistence).
 */
export async function handleGetVault(
) : Promise<messageVaultResponse> {
  try {
    const encryptionKey = await handleGetEncryptionKey();

    const encryptedVault = await storage.getItem(StorageKeys.ENCRYPTED_VAULT) as string;
    // TODO: the fallback mechanism can be removed some period of time after 0.27.0 is released.
    const publicEmailDomains = await getStorageItem<string[]>(StorageKeys.PUBLIC_EMAIL_DOMAINS);
    const privateEmailDomains = await getStorageItem<string[]>(StorageKeys.PRIVATE_EMAIL_DOMAINS);
    const hiddenPrivateEmailDomains = await getStorageItem<string[]>(StorageKeys.HIDDEN_PRIVATE_EMAIL_DOMAINS) ?? [];

    if (!encryptedVault) {
      console.error('Vault not available');
      // E-201: No encrypted vault in storage
      return { success: false, error: formatErrorWithCode(await t('common.errors.vaultNotAvailable'), AppErrorCode.VAULT_NOT_FOUND) };
    }

    if (!encryptionKey) {
      console.info('Encryption key not available (vault locked)');
      // E-202: No encryption key available (vault is locked)
      return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
    }

    const decryptedVault = await EncryptionUtility.symmetricDecrypt(
      encryptedVault,
      encryptionKey
    );

    return {
      success: true,
      vault: decryptedVault,
      publicEmailDomains: publicEmailDomains ?? [],
      privateEmailDomains: privateEmailDomains ?? [],
      hiddenPrivateEmailDomains: hiddenPrivateEmailDomains ?? []
    };
  } catch (error) {
    console.error('Failed to get vault:', error);
    // E-203: Vault decryption failed during get
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.VAULT_DECRYPT_FAILED) };
  }
}

/**
 * Lock the vault by clearing only session data.
 * This preserves local vault data so user can unlock again without server.
 */
export async function handleLockVault(): Promise<messageBoolResponse> {
  await storage.removeItems([...VAULT_LOCK_STORAGE_KEYS]);
  cleanupCachedSqliteClient();

  return { success: true };
}

/**
 * Clear session data: tokens, ephemeral data and the vault itself.
 */
export async function handleClearSession(): Promise<messageBoolResponse> {
  // Clear auth tokens and last sync error
  await storage.removeItems([...AUTH_STORAGE_KEYS]);

  // Clear session-only data (security: encryption key must not persist)
  await storage.removeItems([...SESSION_STORAGE_KEYS]);

  // Clear the vault and every piece of state derived from it (sync bookkeeping, dirty flags, blob cache).
  await storage.removeItems(vaultDataStorageKeys());

  // Reset password unlock failed attempts counter on logout
  await LocalPreferencesService.resetPasswordUnlockFailedAttempts();

  // Cleanup cached sqlite client
  cleanupCachedSqliteClient();

  return { success: true };
}

/**
 * Clear vault data and username.
 * This removes all persistent vault storage and local preferences.
 */
export async function handleClearVaultData(): Promise<messageBoolResponse> {
  /*
   * Clear vault data and every piece of state derived from it (sync bookkeeping, dirty flags, bucket revisions),
   * plus the username, which a forced logout keeps for the login prefill and a user-initiated logout drops.
   */
  await storage.removeItems([...vaultDataStorageKeys(), StorageKeys.USERNAME]);

  // Clear all local preferences (site settings, login save settings, etc.)
  await LocalPreferencesService.clearAll();

  // Free the decrypted vault held in service-worker memory alongside the persisted data it came from.
  cleanupCachedSqliteClient();

  return { success: true };
}

/**
 * Filter items by URL matching.
 *
 * @param items - The items to filter
 * @param currentUrl - The current URL of the page
 * @param pageTitle - The title of the page
 * @param matchingModeStr - The matching mode to use (default: DEFAULT)
 * @returns The filtered items
 */
function filterItemsByUrl(items: Item[], currentUrl: string, pageTitle: string, matchingModeStr?: string): Promise<Item[]> {
  const matchingMode = matchingModeStr ? (matchingModeStr as typeof AutofillMatchingMode[keyof typeof AutofillMatchingMode]) : AutofillMatchingMode.DEFAULT;
  return filterItems(items, currentUrl, pageTitle, matchingMode);
}

/**
 * Prioritize recently selected item in the filtered items list.
 * If a recently selected item exists and is valid, ensure it's at the front of the array.
 * If the item is not in the filtered results, fetch it from the vault and add it.
 *
 * @param items - The filtered items array
 * @param rootDomain - The current root domain for recently selected item validation
 * @param allItems - All items from the vault (to fetch recently selected if not in filtered)
 * @returns The items (with recently selected prioritized) and the matched id, if any
 */
async function prioritizeRecentlySelectedItem(
  items: Item[],
  rootDomain: string,
  allItems: Item[]
): Promise<{ items: Item[], recentlySelectedId: string | null }> {
  const recentlySelectedId = await RecentlySelectedItemService.getRecentlySelected(rootDomain);

  if (!recentlySelectedId) {
    return { items, recentlySelectedId: null };
  }

  // Find the recently selected item in the filtered results
  const recentlySelectedIndex = items.findIndex(item => item.Id === recentlySelectedId);

  if (recentlySelectedIndex !== -1) {
    // Item is already in filtered results - move it to the front
    const recentlySelectedItem = items[recentlySelectedIndex];
    const reorderedItems = [
      recentlySelectedItem,
      ...items.slice(0, recentlySelectedIndex),
      ...items.slice(recentlySelectedIndex + 1)
    ];
    return { items: reorderedItems, recentlySelectedId };
  }

  // Item is not in filtered results - fetch it from all items and prepend it
  const recentlySelectedItem = allItems.find(item => item.Id === recentlySelectedId);

  if (!recentlySelectedItem) {
    // Item not found in vault (might have been deleted)
    return { items, recentlySelectedId: null };
  }

  // Prepend the recently selected item to the filtered results
  return { items: [recentlySelectedItem, ...items], recentlySelectedId };
}

/**
 * Extract the root domain from a URL for recently-selected item scoping.
 * Uses root domain (e.g. `example.com` for both `accounts.example.com` and `login.example.com`)
 * so multi-step login flows that span subdomains still match.
 * @param url - The full URL
 * @returns The root domain, or the original URL if parsing fails
 */
async function extractRootDomainFromUrl(url: string): Promise<string> {
  try {
    const urlObj = new URL(url);
    return await extractRootDomain(urlObj.hostname);
  } catch {
    return url;
  }
}

/**
 * Filter items by search term.
 * Splits search into words and matches items where ALL words appear in searchable fields.
 * Word order doesn't matter - matching behavior consistent with popup search.
 *
 * @param items - The items to filter
 * @param searchTerm - The search term to use
 * @returns The filtered items
 */
function filterItemsBySearchTerm(items: Item[], searchTerm: string): Item[] {
  if (!searchTerm || searchTerm.trim() === '') {
    return [];
  }

  const searchLower = searchTerm.toLowerCase().trim();

  // Split search query into individual words (same as popup search)
  const searchWords = searchLower.split(/\s+/).filter(word => word.length > 0);

  const searchableFieldKeys = [
    FieldKey.LoginUsername,
    FieldKey.LoginEmail,
    FieldKey.LoginUrl,
    FieldKey.AliasFirstName,
    FieldKey.AliasLastName
  ];

  return items.filter((item: Item) => {
    // Build searchable fields array
    const searchableFields: string[] = [
      item.Name?.toLowerCase() || ''
    ];

    // Add field values to searchable fields
    item.Fields?.forEach((field: { FieldKey: string; Value: string | string[]; Label: string }) => {
      if ((searchableFieldKeys as string[]).includes(field.FieldKey)) {
        const value = Array.isArray(field.Value) ? field.Value.join(' ') : field.Value;
        searchableFields.push(value?.toLowerCase() || '');
        searchableFields.push(field.Label.toLowerCase());
      }
    });

    // Every word must appear in at least one searchable field (order doesn't matter)
    return searchWords.every(word =>
      searchableFields.some(field => field.includes(word))
    );
  }).sort((a: Item, b: Item) => (a.Name ?? '').localeCompare(b.Name ?? ''));
}

/**
 * Get items filtered by URL matching (for autofill).
 * Filters items in the background script before sending to reduce message payload size.
 *
 * @param message - Filtering parameters: currentUrl, pageTitle, matchingMode, skipRecentlySelected
 */
export async function handleGetFilteredItems(
  message: { currentUrl: string, pageTitle: string, matchingMode?: string, includeRecentlySelected?: boolean }
) : Promise<messageItemsResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    // E-202: Vault is locked
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const allItems = sqliteClient.items.getAll();
    const filteredItems = await filterItemsByUrl(allItems, message.currentUrl, message.pageTitle, message.matchingMode);

    // Prioritize recently selected item for multi-step login flows (opt-in only)
    if (message.includeRecentlySelected) {
      const rootDomain = await extractRootDomainFromUrl(message.currentUrl);
      const prioritized = await prioritizeRecentlySelectedItem(filteredItems, rootDomain, allItems);
      return { success: true, items: prioritized.items, recentlySelectedId: prioritized.recentlySelectedId };
    }

    return { success: true, items: filteredItems };
  } catch (error) {
    console.error('Error getting filtered items:', error);
    // E-304: Item read failed
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Get items filtered by text search query.
 * Searches across entire vault (name, fields) and returns matches.
 *
 * @param message - Search parameters: searchTerm
 */
export async function handleGetSearchItems(
  message: { searchTerm: string }
) : Promise<messageItemsResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    // E-202: Vault is locked
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const allItems = sqliteClient.items.getAll();
    const searchResults = filterItemsBySearchTerm(allItems, message.searchTerm);

    return { success: true, items: searchResults };
  } catch (error) {
    console.error('Error searching items:', error);
    // E-304: Item read failed during search
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Get default email domain for a vault.
 * Falls back to first private or public domain if no default is configured.
 */
export function handleGetDefaultEmailDomain(): Promise<stringResponse> {
  return (async (): Promise<stringResponse> => {
    try {
      const sqliteClient = await createVaultSqliteClient();
      let domain = sqliteClient.settings.getDefaultEmailDomain();

      // If no default domain is configured, fall back to first private or public domain
      if (!domain) {
        const privateEmailDomains = await getStorageItem<string[]>(StorageKeys.PRIVATE_EMAIL_DOMAINS) ?? [];
        const publicEmailDomains = await getStorageItem<string[]>(StorageKeys.PUBLIC_EMAIL_DOMAINS) ?? [];
        domain = privateEmailDomains[0] || publicEmailDomains[0] || '';
      }

      return { success: true, value: domain || undefined };
    } catch (error) {
      console.error('Error getting default email domain:', error);
      // E-601: Storage read failed
      return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_READ_FAILED) };
    }
  })();
}

/**
 * Get the default identity settings.
 * Returns the effective language (with smart UI language matching if no explicit override is set).
 */
export async function handleGetDefaultIdentitySettings(
) : Promise<IdentitySettingsResponse> {
  try {
    const sqliteClient = await createVaultSqliteClient();
    const language = await sqliteClient.settings.getEffectiveIdentityLanguage();
    const gender = sqliteClient.settings.getDefaultIdentityGender();

    return {
      success: true,
      settings: {
        language,
        gender
      }
    };
  } catch (error) {
    console.error('Error getting default identity settings:', error);
    // E-601: Storage read failed
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_READ_FAILED) };
  }
}

/**
 * Get the password settings.
 */
export async function handleGetPasswordSettings(
) : Promise<messagePasswordSettingsResponse> {
  try {
    const sqliteClient = await createVaultSqliteClient();
    const passwordSettings = sqliteClient.settings.getPasswordSettings();

    return { success: true, settings: passwordSettings };
  } catch (error) {
    console.error('Error getting password settings:', error);
    // E-601: Storage read failed
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_READ_FAILED) };
  }
}

/**
 * Generate a password or passphrase from the given settings using the Rust core.
 */
export async function handleGeneratePassword(
  settings: PasswordSettings
): Promise<{ success: boolean; password?: string; error?: string }> {
  try {
    const password = await generatePassword(settings);
    return { success: true, password };
  } catch (error) {
    console.error('Error generating password:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.UNKNOWN_ERROR) };
  }
}

/**
 * Get the encryption key for the encrypted vault.
 */
export async function handleGetEncryptionKey(
) : Promise<string | null> {
  // Try the current key name first (since 0.22.0)
  const encryptionKey = await storage.getItem(StorageKeys.ENCRYPTION_KEY) as string | null;

  // LEGACY: fall back to the pre-0.22.0 key name.
  return encryptionKey ?? await readLegacySessionEncryptionKey();
}

/**
 * Get the encryption key derivation parameters for password change detection and offline mode.
 * These are stored in local: storage to enable offline unlock after browser restart.
 */
export async function handleGetEncryptionKeyDerivationParams(
) : Promise<EncryptionKeyDerivationParams | null> {
  // Get metadata from storage
  return await getStorageItem<EncryptionKeyDerivationParams>(StorageKeys.ENCRYPTION_KEY_DERIVATION_PARAMS);
}

/**
 * Push only the data buckets named by the dirty scopes, no manifest upload. Used when every pending local
 * mutation since the last sync is bucket-scoped (e.g. a settings toggle): the server's vault content manifest
 * is still current, so re-uploading it would be pure waste.
 *
 * Unknown categories fall back to a full vault upload, which always covers everything.
 * @param sqliteClient - the in-memory SQLite client to read bucket data from
 * @param scopes - the pending dirty scopes (bucket category names, deduplicated here)
 */
async function uploadDirtyBucketsOnly(sqliteClient: SqliteClient, scopes: VaultMutationScope[]): Promise<VaultPushOutcome> {
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    throw new Error(formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
  }

  /*
   * Which tables make up each bucket category is owned by the Rust layer, and so is splitting their rows
   * across the manifests that own them: this loop reads a category whole and hands it over per category.
   */
  const layout = await vaultCodecBucketLayout();
  const username = (await storage.getItem(StorageKeys.USERNAME)) as string;

  if (!sqliteClient.getActiveManifestId() && !sqliteClient.getPersonalManifestId()) {
    devWarn('[V2Push] No manifest to address the bucket write to, falling back to a full vault upload.');
    return (await uploadNewVaultToServer(sqliteClient, { forceFullWrite: false, createVaultKey: false })).response;
  }

  // Same rule as the full push: a vault holding manifests this session cannot write is re-synced, not written to.
  if (await vaultHoldsUnwritableManifests()) {
    return { status: 2 };
  }

  /*
   * Every manifest this vault can write. Each gets a bucket back, empty where it holds no rows of the
   * category, so deleting a manifest's last row still reaches the server.
   */
  const writeKeys = await vaultSyncService.resolveBucketWriteKeys(sqliteClient, encryptionKey);
  const overflowTable = await vaultCodecOverflowTable();

  for (const category of new Set(scopes)) {
    const spec = layout.find(entry => entry.category === category);
    if (!spec) {
      devWarn(`[V2Push] Unknown bucket scope "${category}", falling back to full vault upload.`);
      return (await uploadNewVaultToServer(sqliteClient, { forceFullWrite: false, createVaultKey: false })).response;
    }

    const tables = VaultCodec.readNamedTables(sqliteClient, [...spec.tables, overflowTable]);
    const buckets = await vaultCodecExtractBuckets(category, [...writeKeys.keys()], tables);

    for (const bucket of buckets) {
      const result = await vaultSyncService.pushDataBucketOnly(bucket, writeKeys.get(bucket.manifestId)!, username);
      if (result.status !== 'ok') {
        // Conflict persisted even after the rebase-retry, let the caller run a full re-sync (status 2).
        return { status: 2 };
      }
      devLog(`[V2Push] Bucket-only push for "${category}" of manifest ${bucket.manifestId} done (bucket revision ${result.revision}); manifest untouched.`);
    }
  }

  // Manifests untouched, so every manifest revision baseline stays where it was.
  return { status: 0 };
}

/**
 * Upload the currently stored vault to the server.
 * Returns the upload status and captures the mutation sequence at start for race detection.
 *
 * Bucket-aware: when every pending mutation is scoped to a data bucket (e.g. Settings), only those buckets
 * are pushed. A dirty 'manifest' scope (or a dirty state with no recorded scopes) triggers the full upload path,
 * whose content-fingerprint gating then narrows the write down to the manifests/buckets that actually changed.
 *
 * @param options - set forceFullWrite to rewrite every manifest and bucket regardless of change detection, for when
 *   the fingerprints cannot be trusted to describe the server's state (the legacy storage-format guard is the only
 *   caller); set createVaultKey to mint the VEK as part of this push (the explicit storage migration passes this,
 *   and it is the only caller that should)
 */
export async function handleUploadVault(
  options?: { forceFullWrite?: boolean; createVaultKey?: boolean }
) : Promise<messageVaultUploadResponse> {
  try {
    // Capture mutation sequence at start of upload for race detection
    const mutationSeqAtStart = await storage.getItem(StorageKeys.MUTATION_SEQUENCE) as number | null ?? 0;

    // Create sqlite client from the already-stored vault blob.
    const sqliteClient = await createVaultSqliteClient();

    /*
     * Check if vault key is available on server, if so, adopt it.
     */
    if (!await adoptRemoteVaultKeyIfNeeded()) {
      throw new Error(formatErrorWithCode('Vault encryption key out of sync with the server; please log in again', AppErrorCode.VAULT_DECRYPT_FAILED));
    }
    
    // Handle creating a vault key if it is not available. TODO: delete once all users have migrated to the manifest-v1 storage model.
    const createVaultKey = options?.createVaultKey === true || !await VaultKeyService.hasLocalVaultKey();

    // Upload to the server: bucket-only when possible, full vault otherwise. A forced full write skips the bucket-only shortcut.
    const forceFullWrite = options?.forceFullWrite === true;
    const dirtyScopes = await getDirtyScopes();
    const bucketOnly = !forceFullWrite && !createVaultKey && dirtyScopes.length > 0 && !dirtyScopes.some(isManifestScope);
    if (bucketOnly) {
      devLog(`[V2Push] All pending mutations are bucket-scoped (${dirtyScopes.join(', ')}), skipping manifest upload.`);
    }
    let response: VaultPushOutcome;
    let vaultPruned = false;
    if (bucketOnly) {
      // Bucket-only pushes never prune (settings buckets carry no trash items).
      response = await uploadDirtyBucketsOnly(sqliteClient, dirtyScopes);
    } else {
      ({ response, vaultPruned } = await uploadNewVaultToServer(sqliteClient, { forceFullWrite, createVaultKey }));
    }

    return {
      success: true,
      status: response.status,
      mutationSeqAtStart,
      vaultPruned
    };
  } catch (error) {
    console.error('Failed to upload vault:', error);

    /*
     * E-805: Vault transfer timed out.
     */
    if (error instanceof RequestTimeoutError) {
      return { success: false, error: formatErrorWithCode(await t('common.errors.vaultSyncTimeout'), AppErrorCode.UPLOAD_TIMEOUT) };
    }

    /*
     * Let network and auth errors propagate.
     */
    if (error instanceof NetworkError || error instanceof ApiAuthError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : '';

    // Check if error is UPLOAD_OUTDATED (E-802) - server has newer vault
    if (errorMessage.includes('E-802')) {
      // Return status 2 (Outdated) so caller can handle merge
      return { success: false, status: 2, error: errorMessage };
    }

    /*
     * Pass through any error already tagged with an E-XXX code (e.g. E-804 for HTTP 413).
     * Stripping the targeted code and replacing it with E-801 would lose the actionable message.
     */
    if (/E-\d{3}/.test(errorMessage)) {
      return { success: false, error: errorMessage };
    }

    /*
     * E-801: Upload failed. Include the HTTP status and server error code (if any).
     */
    const detail = error instanceof ApiRequestError ? ` [${error.message}]` : '';
    return { success: false, error: formatErrorWithCode(`${await t('common.errors.unknownError')}${detail}`, AppErrorCode.UPLOAD_FAILED) };
  }
}

/**
 * Handle persisting form values to storage.
 * Data is encrypted using the derived key for additional security.
 */
export async function handlePersistFormValues(data: any): Promise<void> {
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    // E-504: Encryption key not found
    throw new Error(formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ENCRYPTION_KEY_NOT_FOUND));
  }

  // Always stringify the data properly
  const serializedData = JSON.stringify(data);
  const encryptedData = await EncryptionUtility.symmetricEncrypt(
    serializedData,
    encryptionKey
  );
  await storage.setItem(StorageKeys.PERSISTED_FORM_VALUES, encryptedData);
}

/**
 * Handle retrieving persisted form values from storage.
 * Data is decrypted using the derived key.
 */
export async function handleGetPersistedFormValues(): Promise<any | null> {
  const encryptionKey = await handleGetEncryptionKey();
  const encryptedData = await storage.getItem(StorageKeys.PERSISTED_FORM_VALUES) as string | null;

  if (!encryptedData || !encryptionKey) {
    return null;
  }

  try {
    const decryptedData = await EncryptionUtility.symmetricDecrypt(
      encryptedData,
      encryptionKey
    );
    return JSON.parse(decryptedData);
  } catch (error) {
    console.error('Failed to decrypt or parse persisted form values:', error);
    return null;
  }
}

/**
 * Handle clearing persisted form values from storage.
 */
export async function handleClearPersistedFormValues(): Promise<void> {
  await storage.removeItem(StorageKeys.PERSISTED_FORM_VALUES);
}

/**
 * Upload a new version of the vault to the server using the provided sqlite client.
 * Prunes expired trash items before uploading.
 * @param sqliteClient - the in-memory SQLite client to upload
 * @param options - forceFullWrite: whether to force a full write of the vault, createVaultKey: whether to create a vault key
 */
async function uploadNewVaultToServer(sqliteClient: SqliteClient, options: { forceFullWrite: boolean; createVaultKey: boolean }) : Promise<{ response: VaultPushOutcome; vaultPruned: boolean }> {
  devLog('[VaultSync] Upload started');
  let vaultPruned = false;
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    // E-202: Vault is locked
    throw new Error(formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
  }

  /**
   * Prune expired items from trash before uploading.
   * Items that have been in trash (DeletedAt set) longer than TRASH_RETENTION_DAYS
   * are permanently deleted (IsDeleted = true) as part of the sync process.
   * Runs in place on the live client; in the common case (nothing expired) it only costs the table reads.
   */
  try {
    const prunedStatementCount = await vaultMergeService.pruneInPlace(sqliteClient, TRASH_RETENTION_DAYS);
    if (prunedStatementCount > 0) {
      devLog(`[VaultSync] Pruned expired items from trash (${prunedStatementCount} statements)`);
      vaultPruned = true;
      // The prune mutated the vault without bumping the mutation sequence, so a cached pre-push canonicalize result is stale.
      invalidateCanonicalizeCache();
    }
  } catch (pruneError) {
    console.warn('[VaultSync] Failed to prune vault, continuing with upload:', pruneError);
  }

  let pushResponse: VaultPushOutcome;
  try {
    pushResponse = await pushVaultToServer(sqliteClient, options);
  } catch (err) {
    if (err instanceof ServerUpdateRequiredError) {
      throw new Error(formatErrorWithCode(await t('common.errors.serverVersionNotSupported'), AppErrorCode.SERVER_UPDATE_REQUIRED));
    }
    if (err instanceof PayloadTooLargeError) {
      throw new Error(formatErrorWithCode(await t('common.errors.vaultTooLarge'), AppErrorCode.UPLOAD_TOO_LARGE));
    }
    throw err;
  }

  /*
   * Re-encrypt and persist locally only when the stored blob went stale or encryption key changed.
   */
  const currentKey = await handleGetEncryptionKey() ?? encryptionKey;
  if (vaultPruned || currentKey !== encryptionKey) {
    const reEncrypted = await EncryptionUtility.symmetricEncrypt(sqliteClient.exportToBase64(), currentKey);
    await storage.setItem(StorageKeys.ENCRYPTED_VAULT, reEncrypted);
    cachedSqliteClient = sqliteClient;
    cachedVaultBlob = reEncrypted;
  }

  return { response: pushResponse, vaultPruned };
}

/**
 * Persist a locally-mutated vault and attempt to sync it to the server in the background.
 *
 * This is tolerant to server being offline (in which case the vault state will be stored locally for next sync).
 * @param sqliteClient - the mutated vault
 * @param encryptionKey - the key the local blob is stored under
 * @param scope - what the mutation touched; bucket-scoped mutations (e.g. 'Stats') let the sync push just
 *   that data bucket instead of the whole manifest. Defaults to a full manifest push.
 */
async function persistLocalVaultMutation(sqliteClient: SqliteClient, encryptionKey: string, scope?: VaultMutationScope) : Promise<void> {
  const updatedVaultData = sqliteClient.exportToBase64();
  const encryptedVault = await EncryptionUtility.symmetricEncrypt(updatedVaultData, encryptionKey);
  await handleStoreEncryptedVault({ vaultBlob: encryptedVault, markDirty: true, scope });

  /*
   * The stored blob is exactly this client's content, so re-adopt the pair as the cache (the store just cleared
   * it): the sync that follows can then read the vault without another decrypt + sql.js load.
   */
  cachedSqliteClient = sqliteClient;
  cachedVaultBlob = encryptedVault;

  void handleFullVaultSync().catch(error => {
    console.error('Background sync after local vault mutation failed:', error);
  });
}

/**
 * Whether a decrypted vault database is still on the pre-manifest-v1 schema.
 * 
 * TODO: delete once all users have migrated to the manifest-v1 storage model.
 * 
 * @param decryptedBase64 - base64 of the plaintext SQLite database
 */
async function isLegacyStorageVault(decryptedBase64: string): Promise<boolean> {
  const client = new SqliteClient();
  try {
    await client.initializeFromBase64(decryptedBase64);
    return await client.requiresSchemaMigration();
  } catch {
    return false;
  } finally {
    client.close();
  }
}

/**
 * Create a new sqlite client for the stored vault.
 * Uses a cache to avoid repeated decryption and initialization for read operations.
 * Throws when the vault is missing or locked.
 */
export async function createVaultSqliteClient() : Promise<SqliteClient> {
  // Read from local: storage for persistent vault access
  const encryptedVault = await storage.getItem(StorageKeys.ENCRYPTED_VAULT) as string;
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptedVault) {
    // E-201: Vault not found in storage
    throw new Error(formatErrorWithCode(await t('common.errors.vaultNotAvailable'), AppErrorCode.VAULT_NOT_FOUND));
  }
  if (!encryptionKey) {
    // E-202: Vault is locked
    throw new Error(formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
  }

  // Check if we have a valid cached client
  if (cachedSqliteClient && cachedVaultBlob === encryptedVault) {
    return cachedSqliteClient;
  }

  // Decrypt the vault
  const decryptedVault = await EncryptionUtility.symmetricDecrypt(
    encryptedVault,
    encryptionKey
  );

  // Initialize the SQLite client with the decrypted vault
  const sqliteClient = new SqliteClient();
  await sqliteClient.initializeFromBase64(decryptedVault);

  // Cache the client and vault blob
  cachedSqliteClient = sqliteClient;
  cachedVaultBlob = encryptedVault;

  return sqliteClient;
}

/**
 * Get the encrypted vault blob directly (for merge operations).
 */
export async function handleGetEncryptedVault(): Promise<string | null> {
  return await storage.getItem(StorageKeys.ENCRYPTED_VAULT) as string | null;
}

/**
 * Store the encrypted vault blob.
 *
 * Two modes:
 * 1. Local mutation (markDirty=true): Always succeeds, increments mutation sequence
 * 2. Sync operation (expectedMutationSeq provided): Only succeeds if no mutations happened
 *    since sync started. This prevents sync from overwriting concurrent local changes.
 *
 * @param request Object with:
 *   - vaultBlob: The encrypted vault data
 *   - markDirty: If true, marks vault as dirty and increments mutation sequence (for local mutations)
 *   - expectedMutationSeq: If provided, only store if current sequence matches (for sync operations)
 * @returns { success, mutationSequence } - success=false if expectedMutationSeq didn't match
 */
export async function handleStoreEncryptedVault(request: {
  vaultBlob: string;
  markDirty?: boolean;
  expectedMutationSeq?: number;
  scope?: VaultMutationScope;
}): Promise<{ success: boolean; mutationSequence: number }> {
  let mutationSequence = await storage.getItem(StorageKeys.MUTATION_SEQUENCE) as number | null ?? 0;

  /*
   * If expectedMutationSeq is provided, this is a sync operation.
   * Reject if mutations happened during sync to avoid overwriting local changes.
   */
  if (request.expectedMutationSeq !== undefined && request.expectedMutationSeq !== mutationSequence) {
    return { success: false, mutationSequence };
  }

  if (request.markDirty) {
    // Increment mutation sequence and mark as dirty.
    mutationSequence++;
  }

  // Track what changed so the next sync can choose a cheap bucket-only push (e.g. a settings toggle) over a full manifest push.
  const dirtyScopeKey = dirtyScopeStorageKey(request.scope ?? DEFAULT_VAULT_MUTATION_SCOPE);

  // Build items to store.
  if (request.markDirty) {
    await storage.setItems([
      { key: StorageKeys.ENCRYPTED_VAULT, value: request.vaultBlob },
      { key: StorageKeys.MUTATION_SEQUENCE, value: mutationSequence },
      { key: StorageKeys.IS_DIRTY, value: true },
      { key: dirtyScopeKey, value: true }
    ]);
  } else {
    await storage.setItem(StorageKeys.ENCRYPTED_VAULT, request.vaultBlob);
  }

  // Clear cache since vault blob changed
  cachedSqliteClient = null;
  cachedVaultBlob = null;

  return { success: true, mutationSequence };
}

/**
 * Result of the manifest migration.
 */
export type VaultManifestMigrationResult = {
  success: boolean;
  pushed: boolean;
  error?: string;
};

/**
 * Classify the pending migration so the migration gate logic knows whether it may run on its own.
 */
export async function handleGetVaultMigrationStatus(): Promise<VaultMigrationStatus> {
  try {
    const sqliteClient = await createVaultSqliteClient();

    if (await sqliteClient.requiresLegacySqliteBlobMigration()) {
      // The frozen sqlite-blob chain runs first, under its own /upgrade gate; nothing here applies yet.
      return { kind: VaultMigrationKind.None, serverConfirmed: true };
    }

    // Ask the server whether it holds a key hierarchy for this account, and adopt it when it does.
    let serverConfirmed = false;
    try {
      const probe = await VaultKeyService.fetchVaultKey();
      serverConfirmed = probe.supported;
      if (probe.vaultKey) {
        await adoptRemoteVaultKeyIfNeeded();
      }
    } catch (probeError) {
      devWarn('[ManifestMigration] Vault key probe failed, classifying from local state:', probeError);
    }

    if (await requiresLegacyAccountKeyMigration()) {
      return { kind: VaultMigrationKind.StorageFormatUpgrade, serverConfirmed };
    }

    if (await sqliteClient.requiresSchemaMigration()) {
      return { kind: VaultMigrationKind.SchemaRebuild, serverConfirmed: true };
    }

    return { kind: VaultMigrationKind.None, serverConfirmed: true };
  } catch (error) {
    devWarn('[ManifestMigration] Could not classify the pending migration, assuming it crosses the storage format:', error);
    return { kind: VaultMigrationKind.StorageFormatUpgrade, serverConfirmed: false };
  }
}

/**
 * Upgrade local manifest-v1 storage model to the current schema (if needed).
 */
export async function handleMigrateVaultManifest(): Promise<VaultManifestMigrationResult> {
  try {
    const encryptionKey = await handleGetEncryptionKey();
    if (!encryptionKey) {
      // E-202: Vault is locked
      return { success: false, pushed: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
    }

    const sqliteClient = await createVaultSqliteClient();

    if (await sqliteClient.requiresLegacySqliteBlobMigration()) {
      // The sqlite-blob upgrade chain has to bring the vault to 2.0.0 first; the codec cannot canonicalize what came before.
      return { success: false, pushed: false, error: await t('content.vaultUpgradeRequired') };
    }

    // Check if vault key is available on server, if so, adopt it.
    if (!await adoptRemoteVaultKeyIfNeeded()) {
      return { success: false, pushed: false, error: formatErrorWithCode('Vault encryption key out of sync with the server; please log in again', AppErrorCode.VAULT_DECRYPT_FAILED) };
    }

    const needsSchemaMigration = await sqliteClient.requiresSchemaMigration();
    const needsVaultKey = await requiresLegacyAccountKeyMigration();
    if (!needsSchemaMigration && !needsVaultKey) {
      devLog('[ManifestMigration] Vault is already on the current storage model, nothing to migrate.');
      return { success: true, pushed: true };
    }

    // Step 1: local migration. Store it dirty so the vault is usable immediately, with or without a server.
    if (needsSchemaMigration) {
      const migratedBase64 = await vaultSyncService.migrateVaultToCurrentSchema(sqliteClient);
      const migratedEncrypted = await EncryptionUtility.symmetricEncrypt(migratedBase64, encryptionKey);
      await handleStoreEncryptedVault({ vaultBlob: migratedEncrypted, markDirty: true });

      // Invalidate any local cached results that are now stale.
      invalidateCanonicalizeCache();
      devLog('[ManifestMigration] Local vault migrated and stored; pushing the migrated vault to the server...');
    } else {
      devLog('[ManifestMigration] Schema is current; pushing to mint the vault key.');
    }

    /*
     * Step 2: push the migrated vault to the server.
     */
    try {
      const uploadResponse = await handleUploadVault({ createVaultKey: needsVaultKey });
      if (uploadResponse.success && uploadResponse.status === 0) {
        await handleMarkVaultClean({ mutationSeqAtStart: uploadResponse.mutationSeqAtStart! });
        devLog('[ManifestMigration] Migration pushed to the server.');
        return { success: true, pushed: true };
      }
      devWarn('[ManifestMigration] Migration push did not succeed, vault stays dirty for the next sync:', uploadResponse.error);
    } catch (pushError) {
      devWarn('[ManifestMigration] Migration push failed, vault stays dirty for the next sync:', pushError);
    }

    return { success: true, pushed: false };
  } catch (error) {
    devError('[ManifestMigration] Manifest migration failed:', error);
    return { success: false, pushed: false, error: error instanceof Error ? error.message : await t('common.errors.unknownError') };
  }
}

/**
 * Mark the vault as clean after successful sync.
 * Only clears dirty flag if no mutations happened during sync.
 *
 * @param mutationSeqAtStart - The mutation sequence when sync started
 * @returns Whether the dirty flag was cleared
 */
export async function handleMarkVaultClean(request: {
  mutationSeqAtStart: number;
}): Promise<{ cleared: boolean; currentMutationSeq: number }> {
  const currentMutationSeq = await storage.getItem(StorageKeys.MUTATION_SEQUENCE) as number | null ?? 0;

  if (currentMutationSeq === request.mutationSeqAtStart) {
    // No mutations during sync - safe to mark as clean
    await storage.setItem(StorageKeys.IS_DIRTY, false);
    await clearDirtyScopes();
    return { cleared: true, currentMutationSeq };
  }

  return { cleared: false, currentMutationSeq };
}

/**
 * Local sync bookkeeping: whether the vault holds changes that still have to be pushed, the mutation counter
 * they were recorded at, and whether a sync is running right now.
 */
export type VaultSyncState = {
  isDirty: boolean;
  mutationSequence: number;
  isSyncInProgress: boolean;
};

/**
 * Get the current sync state.
 */
export async function handleGetSyncState(): Promise<VaultSyncState> {
  const [isDirty, mutationSequence] = await Promise.all([
    storage.getItem(StorageKeys.IS_DIRTY) as Promise<boolean | null>,
    storage.getItem(StorageKeys.MUTATION_SEQUENCE) as Promise<number | null>
  ]);

  return {
    isDirty: isDirty ?? false,
    mutationSequence: mutationSequence ?? 0,
    isSyncInProgress
  };
}

/**
 * Adopt a server-side vault key this device does not know about yet.
 *
 * A missing local encrypted-VEK cache means one of two things: this user is genuinely still legacy (their next full
 * push performs the KEK/VEK migration), or another device migrated while this one held the old password-derived key.
 * Every path that adopts a VEK as the session key writes the encrypted-VEK cache first, so a session key that is
 * already the VEK without a cache is not a reachable state -- it can only come from torn storage, which a re-login fixes.
 *
 * TODO: this method can be removed once all users have migrated to the KEK/VEK model and we don't support legacy users anymore.
 *
 * @returns False only when this device is holding key material that matches neither the KEK nor the VEK, which
 *   requires a re-login; true in every other case, including offline (the next sync retries).
 */
async function adoptRemoteVaultKeyIfNeeded(): Promise<boolean> {
  if (await VaultKeyService.hasLocalVaultKey()) {
    // Already on the KEK/VEK model: the session key is the VEK.
    return true;
  }

  const sessionKey = await handleGetEncryptionKey();
  if (!sessionKey) {
    // Vault is locked; the next unlock/login resolves the key through the vault key endpoint.
    return true;
  }

  let fetchResult;
  try {
    fetchResult = await VaultKeyService.fetchVaultKey();
  } catch (error) {
    // Server unreachable or the probe failed: state is unchanged and unknowable, so let the next sync retry.
    devWarn('[VaultSync] Vault key probe failed, deferring vault key adoption:', error);
    return true;
  }

  if (!fetchResult.vaultKey) {
    // Genuinely legacy: the next full push creates the vault key and re-encrypts the vault under a fresh VEK.
    return true;
  }

  const encryptedVault = await storage.getItem(StorageKeys.ENCRYPTED_VAULT) as string | null;

  try {
    // Decrypt the encrypted Account Key and VEK.
    const accountKey = await EncryptionUtility.decryptVaultEncryptionKey(fetchResult.vaultKey.encryptedAccountKey, sessionKey);
    const vek = fetchResult.vaultKey.encryptedVek ? await EncryptionUtility.decryptVaultEncryptionKey(fetchResult.vaultKey.encryptedVek, accountKey) : accountKey;

    // Re-encrypt the locally persisted vault with the VEK before swapping the session key.
    if (encryptedVault) {
      const decrypted = await EncryptionUtility.symmetricDecrypt(encryptedVault, sessionKey);
      await storage.setItem(StorageKeys.ENCRYPTED_VAULT, await EncryptionUtility.symmetricEncrypt(decrypted, vek));
    }

    await VaultKeyService.cacheVaultKeyBlobs(fetchResult.vaultKey);
    await handleStoreEncryptionKey(vek);
    cachedSqliteClient = null;
    cachedVaultBlob = null;
    devLog('[VaultSync] Adopted vault key created by another client; session key swapped to the VEK.');
    return true;
  } catch (error) {
    /*
     * Decryption failed, so this device holds key material that is not the KEK the server encrypted the VEK with.
     * We trigger a re-login to fix the problem.
     */
    devError('[VaultSync] Session key matches neither the KEK nor the VEK, forcing re-login:', error);
    return false;
  }
}

/**
 * What a running sync is doing, broadcast to the popup so it can show the matching indicator.
 * 'pull' = downloading a newer server vault, 'push' = uploading local changes, 'idle' = nothing in flight.
 */
export type VaultSyncPhase = 'pull' | 'push' | 'idle';

/**
 * Tell any open popup what the current sync is doing. Fire-and-forget: with no popup open there is no
 * receiver and runtime messaging rejects, which is expected and ignored.
 * @param phase - the phase to broadcast
 */
function broadcastSyncPhase(phase: VaultSyncPhase): void {
  sendMessage('VAULT_SYNC_PHASE', { phase }).catch(() => {});
}

/**
 * Result of a full vault sync operation.
 */
export type FullVaultSyncResult = {
  success: boolean;
  hasNewVault: boolean;
  wasOffline: boolean;
  sqliteBlobUpgradeRequired: boolean;
  manifestMigrationRequired?: boolean;
  error?: string;
  errorKey?: string;
  requiresLogout: boolean;
};

/**
 * Persists a sync error message to local storage so the popup can surface it
 * even when the failing sync was triggered from the background (e.g. follow-up
 * syncs after pending mutations). Cleared on the next successful sync.
 *
 * Skips errors that already have dedicated UX:
 * - requiresLogout: handled by the forced re-login flow
 * - wasOffline: handled by the offline indicator
 */
async function persistSyncErrorState(result: FullVaultSyncResult): Promise<void> {
  if (result.requiresLogout || result.wasOffline) {
    return;
  }

  const errorMessage = result.errorKey
    ? await t('common.errors.' + result.errorKey)
    : result.error;

  if (errorMessage) {
    await storage.setItem(StorageKeys.LAST_SYNC_ERROR, errorMessage);
  } else if (result.success) {
    await storage.removeItem(StorageKeys.LAST_SYNC_ERROR);
  }
}

/**
 * Full vault sync orchestration that runs entirely in background context.
 * Wraps the internal implementation with sync-error persistence so the popup
 * can show a targeted alert for failures even if it wasn't open at the time.
 * @param options - what the caller asks of the sync beyond what the revisions decide
 */
export async function handleFullVaultSync(options?: FullVaultSyncOptions): Promise<FullVaultSyncResult> {
  const result = await handleFullVaultSyncInternal(options);
  await persistSyncErrorState(result);
  return result;
}

/**
 * Build a sync result.
 * @param overrides - the fields that differ from an uneventful, successful sync
 */
function syncResult(overrides: Partial<FullVaultSyncResult> = {}): FullVaultSyncResult {
  return { success: true, hasNewVault: false, wasOffline: false, sqliteBlobUpgradeRequired: false, requiresLogout: false, ...overrides };
}

/**
 * Internal implementation of the full vault sync. Wrapped by handleFullVaultSync
 * so the result can be persisted to local storage for the popup to surface.
 * @param options - what the caller asks of the sync beyond what the revisions decide
 */
async function handleFullVaultSyncInternal(options?: FullVaultSyncOptions): Promise<FullVaultSyncResult> {
  // Check if sync is already in progress
  if (isSyncInProgress) {
    // Mark that we need to sync again after current sync completes
    hasPendingSync = true;
    devLog('[VaultSync] Sync already in progress, queued for retry after completion');
    return syncResult();
  }

  // Mark sync as in progress
  isSyncInProgress = true;
  hasPendingSync = false;

  devLog('[VaultSync] Sync started');

  const webApi = new WebApiService();

  try {
    const preflight = await runSyncPreflight(webApi, options);
    if (!preflight.proceed) {
      return preflight.result;
    }

    const { statusResponse, syncState, needsPull } = preflight;

    await announceSyncPhase(needsPull, syncState.isDirty);

    const encryptionKey = await handleGetEncryptionKey();
    if (!encryptionKey) {
      return syncResult({ success: false, error: await t('common.errors.vaultIsLocked') });
    }

    // Chcek for any client pending actions as directed by the server (e.g. shared group invitations, shared group memberships, etc.)
    const grantSyncChangedVault = await applyServerDirectedChanges(webApi, statusResponse, syncState, encryptionKey, needsPull);

    if (needsPull) {
      return await pullAndMaterializeServerVault(syncState, encryptionKey, grantSyncChangedVault);
    }

    if (syncState.isDirty) {
      return await pushPendingLocalChanges(grantSyncChangedVault);
    }

    // No changes to apply, check for any pending migrations.
    return await pendingMigrationResult() ?? syncResult();
  } catch (err) {
    return await mapSyncFailure(err);
  } finally {
    // Reset sync in progress flag
    isSyncInProgress = false;

    devLog('[VaultSync] Sync finished');

    // Clear the popup's sync indicator; a follow-up sync below re-announces its own phase.
    broadcastSyncPhase('idle');

    // Check if another sync is needed (mutations happened during this sync).
    if (hasPendingSync) {
      devLog('[VaultSync] Pending mutations detected, triggering follow-up sync');
      hasPendingSync = false;

      handleFullVaultSync().catch(err => {
        console.error('[VaultSync] Follow-up sync failed:', err);
      });
    }
  }
}

/** What a caller may ask of a full sync beyond what the revisions decide. */
type FullVaultSyncOptions = {
  /** Pull even when the revisions say the vault is current, for state only a pull re-records (the shared-vault key records). */
  forcePull?: boolean;
};

/**
 * Outcome of the sync preflight: either a result the sync returns as-is, or the state the sync then runs on.
 */
type SyncPreflightResult =
  | { proceed: false; result: FullVaultSyncResult }
  | { proceed: true; statusResponse: StatusResponseV2; syncState: VaultSyncState; needsPull: boolean };

/**
 * Stop the sync before it touches the vault, reporting the given result.
 * @param overrides - the fields that differ from an uneventful, successful sync
 */
function abortSync(overrides: Partial<FullVaultSyncResult>): SyncPreflightResult {
  return { proceed: false, result: syncResult(overrides) };
}

/**
 * Sync preflight (sanity checks) to determine if the sync should proceed.
 *
 * @param webApi - the API service the status call runs on
 * @param options - what the caller asks of the sync beyond what the revisions decide
 * @returns Either the result the sync must return unchanged, or the status, sync state and pull decision.
 */
async function runSyncPreflight(webApi: WebApiService, options?: FullVaultSyncOptions): Promise<SyncPreflightResult> {
  // Check if user is logged in
  const authStatus = await handleCheckAuthStatus();
  if (!authStatus.isLoggedIn) {
    return abortSync({ success: false });
  }

  if (authStatus.isVaultLocked) {
    // E-202: Vault is locked
    return abortSync({ success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) });
  }

  // Check app status and vault revision
  const statusResponse = await webApi.getStatus();

  // Get current sync state
  const syncState = await handleGetSyncState();

  let needsPull = options?.forcePull === true || serverManifestsNeedPull(statusResponse.manifestRevisions, await getManifestRevisions());

  devLog(`[VaultSync] Status received (needsPull ${needsPull}, isDirty ${syncState.isDirty})`);

  // Check if server is actually available (0.0.0 indicates connection error)
  if (statusResponse.serverVersion === '0.0.0') {
    return { proceed: false, result: await enterOfflineMode() };
  }

  // Validate status response
  const statusError = webApi.validateStatusResponse(statusResponse);
  if (statusError) {
    const requiresLogout = statusError === 'clientVersionNotSupported' || statusError === 'serverVersionNotSupported';
    return abortSync({ success: false, requiresLogout, errorKey: statusError });
  }

  // Check if the SRP salt has changed (password change detection)
  const storedEncryptionParams = await handleGetEncryptionKeyDerivationParams();
  if (storedEncryptionParams && statusResponse.srpSalt && statusResponse.srpSalt !== storedEncryptionParams.salt) {
    return abortSync({ success: false, requiresLogout: true, errorKey: 'passwordChanged' });
  }

  /*
   * Only needed when we are about to pull: the vault data below is decrypted with the session key, which is stale if
   * another device migrated. An unmigrated device with nothing to pull has nothing to adopt and skips the check.
   */
  if (needsPull && !await adoptRemoteVaultKeyIfNeeded()) {
    return abortSync({ success: false, requiresLogout: true, errorKey: 'passwordChanged' });
  }

  // Valid connection: exit offline mode if we were in it
  const isOffline = await storage.getItem(StorageKeys.IS_OFFLINE_MODE) as boolean | null;
  if (isOffline) {
    await storage.setItem(StorageKeys.IS_OFFLINE_MODE, false);
  }

  if (syncState.isDirty && !needsPull && await clearDirtyStateIfNoOpMutation(syncState.mutationSequence)) {
    syncState.isDirty = false;
  }

  // Check if we are missing any manifest related information that we do have write access for.
  if (syncState.isDirty && !needsPull && await vaultHoldsUnwritableManifests()) {
    needsPull = true;
  }
  if (!needsPull && await vaultHoldsUnrecordedSharedManifests()) {
    needsPull = true;
  }

  return { proceed: true, statusResponse, syncState, needsPull };
}

/**
 * Whether the stored vault holds rows for manifests this session cannot write, which a pull has to repair before
 * anything may be pushed (see {@link VaultSyncService.findUnwritableManifests}). A vault that cannot even be
 * opened answers false: it has its own failure path, and forcing a pull here would only mask it.
 */
async function vaultHoldsUnwritableManifests(): Promise<boolean> {
  try {
    const unwritable = await vaultSyncService.findUnwritableManifests(await createVaultSqliteClient());
    if (unwritable.length === 0) {
      return false;
    }

    devWarn(`[VaultSync] Vault holds rows for manifest(s) this session cannot write (${unwritable.join(', ')}); pulling before the push.`);
    return true;
  } catch (error) {
    devWarn('[VaultSync] Could not check which manifests this session can write; leaving the pull decision to the revisions.', error);
    return false;
  }
}

/**
 * Whether the stored vault holds rows of shared manifests this account has no key record for, which a pull has to repair.
 */
async function vaultHoldsUnrecordedSharedManifests(): Promise<boolean> {
  try {
    const recorded = new Set(Object.values(await SharingService.getSharedManifestRecords()).map(record => record.manifestId.toLowerCase()));
    for (const manifestId of recorded) {
      manifestsPulledForSharedKeys.delete(manifestId);
    }

    const personalManifestId = (await getPersonalManifestId())?.toLowerCase() ?? null;
    const unrecorded = [...VaultCodec.manifestIdsInVault(await createVaultSqliteClient())]
      .map(manifestId => manifestId.toLowerCase())
      .filter(manifestId => manifestId !== personalManifestId && !recorded.has(manifestId) && !manifestsPulledForSharedKeys.has(manifestId));
    if (unrecorded.length === 0) {
      return false;
    }

    for (const manifestId of unrecorded) {
      manifestsPulledForSharedKeys.add(manifestId);
    }

    devWarn(`[VaultSync] Vault holds rows for shared manifest(s) this session has no key record for (${unrecorded.join(', ')}); pulling to re-record them.`);
    return true;
  } catch (error) {
    devWarn('[VaultSync] Could not check which shared manifests this session holds key records for; leaving the pull decision to the revisions.', error);
    return false;
  }
}

/**
 * Fall back to offline mode when the server cannot be reached. Without a local vault there is nothing to fall
 * back on, so that case reports a failure instead.
 */
async function enterOfflineMode(): Promise<FullVaultSyncResult> {
  const encryptedVault = await storage.getItem(StorageKeys.ENCRYPTED_VAULT);
  if (!encryptedVault) {
    return syncResult({ success: false, wasOffline: true, error: await t('common.errors.serverNotAvailable') });
  }

  await storage.setItem(StorageKeys.IS_OFFLINE_MODE, true);
  return syncResult({ wasOffline: true });
}

/**
 * Check if the local vault is canonically identical to the last-known server state, if so, do not unnecessarily push it to the server.
 *
 * @param mutationSequence - the mutation counter the sync started at
 * @returns True when the dirty flag was cleared and there is nothing left to push.
 */
async function clearDirtyStateIfNoOpMutation(mutationSequence: number): Promise<boolean> {
  try {
    const sqliteClient = await createVaultSqliteClient();
    if (!await vaultSyncService.detectNoOpMutation(sqliteClient, mutationSequence)) {
      return false;
    }

    const cleanResult = await handleMarkVaultClean({ mutationSeqAtStart: mutationSequence });
    if (cleanResult.cleared) {
      devLog('[VaultSync] Local changes are canonically identical to the server baselines (no-op mutation); nothing to push.');
    }
    return cleanResult.cleared;
  } catch (preCheckError) {
    devWarn('[VaultSync] No-op mutation pre-check failed, proceeding with a normal push:', preCheckError);
    return false;
  }
}

/**
 * Announce the sync phase to the popup so it can show the right indicator.
 *
 * @param needsPull - whether the sync is about to pull from the server
 * @param isDirty - whether the local vault holds changes that still have to be pushed
 */
async function announceSyncPhase(needsPull: boolean, isDirty: boolean): Promise<void> {
  if (needsPull) {
    broadcastSyncPhase('pull');
  } else if (isDirty && hasUserVisibleScope(await getDirtyScopes())) {
    broadcastSyncPhase('push');
  }
}

/**
 * Carry out the work the server has addressed to this client (primarily related to shared groups).
 *
 * @param webApi - the API service the pending actions are acknowledged on
 * @param statusResponse - the status response carrying the pending actions
 * @param syncState - the sync state, updated in place when the reconciled rows make the vault dirty
 * @param encryptionKey - the key the reconciled vault is re-encrypted with
 * @param needsPull - whether this sync already announced itself as a pull
 * @returns True when the stored vault changed, which the sync has to report as a new vault however it ends.
 */
async function applyServerDirectedChanges(webApi: WebApiService, statusResponse: StatusResponseV2, syncState: VaultSyncState, encryptionKey: string, needsPull: boolean): Promise<boolean> {  
  const pendingActions = PendingActionProcessor.pendingActions(statusResponse);
  const sharedManifests = Object.values(await SharingService.getSharedManifestRecords());
  if (pendingActions.length === 0 && sharedManifests.length === 0) {
    return false;
  }

  const sqliteClient = await createVaultSqliteClient();

  // A vault with a migration still ahead of it is not on the current schema, so it cannot take the new rows yet.
  const canReconcile = !await vaultRequiresManifestMigration(sqliteClient);
  let vaultChanged = canReconcile && await multiManifestRendering.reconcile(sqliteClient, sharedManifests);
  if (canReconcile && pendingActions.length > 0) {
    vaultChanged = await PendingActionProcessor.process(webApi, pendingActions, sqliteClient) || vaultChanged;
  }

  if (!vaultChanged) {
    return false;
  }

  // A rotated delivery key or a re-rendered shared manifest is a normal local change, so it rides out on this very sync.
  const reconciledVault = await EncryptionUtility.symmetricEncrypt(sqliteClient.exportToBase64(), encryptionKey);
  const stored = await handleStoreEncryptedVault({ vaultBlob: reconciledVault, markDirty: true });
  syncState.isDirty = true;
  syncState.mutationSequence = stored.mutationSequence;

  if (!needsPull) {
    broadcastSyncPhase('push');
  }

  // The stored vault now holds a row the caller's in-memory copy does not, so this sync has to report a new vault.
  return true;
}

/**
 * Pull the server's latest vault and merge any local changes onto it.
 *
 * @param syncState - the sync state the pull runs against
 * @param encryptionKey - the key the local and server vaults are encrypted with
 * @param grantSyncChangedVault - whether an earlier step already changed the stored vault
 */
async function pullAndMaterializeServerVault(syncState: VaultSyncState, encryptionKey: string, grantSyncChangedVault: boolean): Promise<FullVaultSyncResult> {
  const vaultResponseJson = await fetchLatestVaultFromServer();

  try {
    if (syncState.isDirty) {
      const mergedResult = await mergeAndPushLocalChanges(vaultResponseJson, syncState, encryptionKey, grantSyncChangedVault);
      if (mergedResult) {
        return mergedResult;
      }
    }

    /*
     * No local changes (or merge failed) - just use server vault.
     * Use expectedMutationSeq to detect concurrent mutations.
     */
    const storeResult = await handleStoreEncryptedVault({
      vaultBlob: vaultResponseJson.vault.blob,
      expectedMutationSeq: syncState.mutationSequence
    });

    if (!storeResult.success) {
      devLog('[VaultSync] Mutation detected during sync, re-syncing...');
      return handleFullVaultSync();
    }

    await storeVaultMetadata(vaultResponseJson);

    return await materializedVaultResult();
  } catch (error) {
    if (error instanceof VaultVersionIncompatibleError) {
      return syncResult({ success: false, requiresLogout: true, error: error.message });
    }
    // E-501: Vault decryption failed
    throw new Error(formatErrorWithCode(
      'Vault could not be decrypted, if the problem persists please logout and login again.',
      AppErrorCode.VAULT_DECRYPT_FAILED
    ));
  }
}

/**
 * Merge the local vault onto the server's latest vault and upload the result.
 *
 * @param vaultResponse - the vault just pulled from the server
 * @param syncState - the sync state the merge runs against
 * @param encryptionKey - the key both vaults are encrypted with
 * @param grantSyncChangedVault - whether an earlier step already changed the stored vault
 * @returns The sync result, or null when there is nothing to merge onto and the caller should take the
 *   server vault as-is (no local vault stored, or the merge itself failed).
 */
async function mergeAndPushLocalChanges(
  vaultResponse: VaultResponse,
  syncState: VaultSyncState,
  encryptionKey: string,
  grantSyncChangedVault: boolean
): Promise<FullVaultSyncResult | null> {
  const localEncryptedVault = await storage.getItem(StorageKeys.ENCRYPTED_VAULT) as string | null;
  if (!localEncryptedVault) {
    return null;
  }

  const localDecrypted = await EncryptionUtility.symmetricDecrypt(localEncryptedVault, encryptionKey);
  const serverDecrypted = await EncryptionUtility.symmetricDecrypt(vaultResponse.vault.blob, encryptionKey);

  /*
   * Guard for the sqlite-blob to manifest-v1 migration window: this device has already migrated its vault onto the current
   * schema but the push has not landed yet, while another (not-yet-updated) device advanced the server's
   * legacy sqlite-blob. The two databases have different column sets, so merging them would throw an error.
   * We assume here the migrated local vault is newer, so it's pushed as-is.
   */
  if (await isLegacyStorageVault(serverDecrypted) && !await isLegacyStorageVault(localDecrypted)) {
    devWarn('[VaultSync] Server vault is still on the legacy storage format while the local vault is migrated; skipping the merge and pushing the local vault.');
    return await pushOverLegacyServerVault(grantSyncChangedVault);
  }

  const mergeResult = await vaultMergeService.merge(localDecrypted, serverDecrypted);

  if (!mergeResult.success) {
    console.error('Vault merge failed during sync, using server vault');
    return null;
  }

  devLog('[VaultSync] Vault merge during sync completed:', mergeResult.stats);

  const mergedEncryptedVault = await EncryptionUtility.symmetricEncrypt(mergeResult.mergedVaultBase64, encryptionKey);

  // Store merged vault. Use expectedMutationSeq to detect if a local mutation happened during merge.
  const storeResult = await handleStoreEncryptedVault({
    vaultBlob: mergedEncryptedVault,
    expectedMutationSeq: syncState.mutationSequence
  });

  if (!storeResult.success) {
    devLog('[VaultSync] Mutation detected during merge, re-syncing...');
    return handleFullVaultSync();
  }

  // Upload merged vault to server
  const uploadResponse = await handleUploadVault();

  if (uploadResponse.success && uploadResponse.status === 0) {
    await handleMarkVaultClean({ mutationSeqAtStart: uploadResponse.mutationSeqAtStart! });
  } else if (uploadResponse.status === 2) {
    // Outdated: another device uploaded first. Re-sync.
    return handleFullVaultSync();
  } else {
    console.error('Failed to upload merged vault:', uploadResponse.error);
    return syncResult({ success: false, error: uploadResponse.error });
  }

  await storeVaultMetadata(vaultResponse);

  return await materializedVaultResult();
}

/**
 * Push the local vault over a server vault that is still on the legacy sqlite-blob format, replacing it whole instead of merging two incompatible schemas.
 *
 * @param grantSyncChangedVault - whether an earlier step already changed the stored vault
 */
async function pushOverLegacyServerVault(grantSyncChangedVault: boolean): Promise<FullVaultSyncResult> {
  const uploadResponse = await handleUploadVault({ forceFullWrite: true });
  if (uploadResponse.success && uploadResponse.status === 0) {
    await handleMarkVaultClean({ mutationSeqAtStart: uploadResponse.mutationSeqAtStart! });
    return syncResult({ hasNewVault: grantSyncChangedVault });
  }

  if (uploadResponse.status === 2) {
    return handleFullVaultSync();
  }

  return syncResult({ success: false, error: uploadResponse.error });
}

/**
 * Push path: server and client agree on every manifest revision, so the pending local changes upload as-is.
 *
 * @param grantSyncChangedVault - whether an earlier step already changed the stored vault
 */
async function pushPendingLocalChanges(grantSyncChangedVault: boolean): Promise<FullVaultSyncResult> {
  const uploadResponse = await handleUploadVault();

  if (uploadResponse.success && uploadResponse.status === 0) {
    await handleMarkVaultClean({ mutationSeqAtStart: uploadResponse.mutationSeqAtStart! });

    /*
     * If expired trash items were pruned during upload, report the vault as new
     * so the popup reloads the pruned vault instead of resurrecting the items
     * from its stale in-memory copy on the next mutation.
     */
    return syncResult({ hasNewVault: uploadResponse.vaultPruned === true || grantSyncChangedVault });
  }

  if (uploadResponse.status === 2) {
    // Outdated: another device uploaded first. Re-sync.
    return handleFullVaultSync();
  }

  console.error('Failed to upload pending vault:', uploadResponse.error);
  return syncResult({ success: false, error: uploadResponse.error });
}

/**
 * Store the email domain lists that came with a pulled vault.
 * @param vaultResponse - the vault response to take the metadata from
 */
async function storeVaultMetadata(vaultResponse: VaultResponse): Promise<void> {
  await handleStoreVaultMetadata({
    publicEmailDomainList: vaultResponse.vault.publicEmailDomainList,
    privateEmailDomainList: vaultResponse.vault.privateEmailDomainList,
    hiddenPrivateEmailDomainList: vaultResponse.vault.hiddenPrivateEmailDomainList,
  });
}

/**
 * Result for a sync that stored a freshly materialized vault, reporting any migrations that new database needs before it can be used.
 */
async function materializedVaultResult(): Promise<FullVaultSyncResult> {
  const sqliteClient = await createVaultSqliteClient();
  const requiresLegacySqliteBlobMigration = await sqliteClient.requiresLegacySqliteBlobMigration();
  const manifestMigrationRequired = await vaultRequiresManifestMigration(sqliteClient);

  return syncResult({ hasNewVault: true, sqliteBlobUpgradeRequired: requiresLegacySqliteBlobMigration, manifestMigrationRequired });
}

/**
 * Check for any pending migrations.
 * @returns The result to return when a migration is pending, null when none is or the check itself failed.
 */
async function pendingMigrationResult(): Promise<FullVaultSyncResult | null> {
  try {
    const sqliteClient = await createVaultSqliteClient();
    if (await sqliteClient.requiresLegacySqliteBlobMigration()) {
      return syncResult({ sqliteBlobUpgradeRequired: true });
    }

    if (await vaultRequiresManifestMigration(sqliteClient)) {
      return syncResult({ manifestMigrationRequired: true });
    }
  } catch {
    // Ignore errors checking migrations
  }

  return null;
}

/**
 * Turn an error thrown during a sync into the result the popup acts on.
 * error message carrying a reportable code.
 *
 * @param err - the error the sync threw
 */
async function mapSyncFailure(err: unknown): Promise<FullVaultSyncResult> {
  console.error('Vault sync error:', err);

  /*
   * The server refuses this extension version for this account (HTTP 426).
   */
  if (err instanceof ClientUpgradeRequiredError) {
    return syncResult({ success: false, requiresLogout: true, errorKey: 'clientVersionNotSupported' });
  }

  // Version incompatibility requires logout
  if (err instanceof VaultVersionIncompatibleError) {
    return syncResult({ success: false, requiresLogout: true, error: err.message });
  }

  // Auth error (session expired) - signal popup to trigger logout
  if (err instanceof ApiAuthError) {
    return syncResult({ success: false, requiresLogout: true, errorKey: 'sessionExpired' });
  }

  // E-805: Vault transfer timed out - show a targeted error instead of entering offline mode
  if (err instanceof RequestTimeoutError) {
    return syncResult({ success: false, error: formatErrorWithCode(await t('common.errors.vaultSyncTimeout'), AppErrorCode.UPLOAD_TIMEOUT) });
  }

  // Network error: enter offline mode if we have a local vault
  if (err instanceof NetworkError && await storage.getItem(StorageKeys.ENCRYPTED_VAULT)) {
    await storage.setItem(StorageKeys.IS_OFFLINE_MODE, true);
    return syncResult({ wasOffline: true });
  }

  // For all other errors, include an error code so users can report it
  const baseMessage = err instanceof Error ? err.message : 'Unknown error during vault sync';
  // Check if message already has an error code (E-XXX format)
  const hasErrorCode = /E-\d{3}/.test(baseMessage);
  const errorMessage = hasErrorCode
    ? baseMessage
    : formatErrorWithCode(baseMessage, AppErrorCode.UNKNOWN_ERROR);

  return syncResult({ success: false, error: errorMessage });
}

/**
 * Check if a login credential already exists in the vault.
 * Used by the save prompt to avoid offering to save duplicates.
 *
 * @param message - The domain and username to check.
 * @returns Whether a duplicate exists and the matching item info if found.
 */
export async function handleCheckLoginDuplicate(
  message: { domain: string; username: string }
): Promise<DuplicateCheckResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, isDuplicate: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const allItems = sqliteClient.items.getAll();

    // Find items with matching domain and username
    const normalizedDomain = message.domain.toLowerCase();
    const normalizedUsername = message.username.toLowerCase();

    for (const item of allItems) {
      // Check LoginUrl field for domain match (supports multi-value URLs)
      const urlField = item.Fields?.find((f: { FieldKey: string }) => f.FieldKey === FieldKey.LoginUrl);
      const urlValue = urlField?.Value;
      if (!urlValue) {
        continue;
      }

      // Normalize URL value to array for consistent handling
      const urls = Array.isArray(urlValue) ? urlValue : [urlValue];

      // Check if any URL matches the domain
      let domainsMatch = false;
      for (const singleUrl of urls) {
        if (typeof singleUrl !== 'string') {
          continue;
        }

        // Extract domain from URL
        let itemDomain: string;
        try {
          const url = new URL(singleUrl.startsWith('http') ? singleUrl : `https://${singleUrl}`);
          itemDomain = url.hostname.toLowerCase();
        } catch {
          // If URL parsing fails, try direct comparison
          itemDomain = singleUrl.toLowerCase();
        }

        // Check if domains match (including subdomains)
        if (itemDomain === normalizedDomain || itemDomain.endsWith(`.${normalizedDomain}`) || normalizedDomain.endsWith(`.${itemDomain}`)) {
          domainsMatch = true;
          break;
        }
      }

      if (!domainsMatch) {
        continue;
      }

      // Check LoginUsername or LoginEmail field for username match
      const usernameField = item.Fields?.find((f: { FieldKey: string }) => f.FieldKey === FieldKey.LoginUsername);
      const emailField = item.Fields?.find((f: { FieldKey: string }) => f.FieldKey === FieldKey.LoginEmail);

      const usernameValue = usernameField?.Value;
      const emailValue = emailField?.Value;

      const itemUsername = (typeof usernameValue === 'string' ? usernameValue : '').toLowerCase();
      const itemEmail = (typeof emailValue === 'string' ? emailValue : '').toLowerCase();

      if (itemUsername === normalizedUsername || itemEmail === normalizedUsername) {
        return {
          success: true,
          isDuplicate: true,
          matchingItemId: item.Id,
          matchingItemName: item.Name ?? undefined
        };
      }
    }

    return { success: true, isDuplicate: false };
  } catch (error) {
    console.error('Error checking for duplicate login:', error);
    return { success: false, isDuplicate: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Save a captured login credential to the vault.
 * Creates a new Login item with the provided credentials.
 *
 * @param message - The login details to save.
 * @returns Success status and the new item ID if created.
 */
export async function handleSaveLoginCredential(
  message: {
    serviceName: string;
    username: string;
    password: string;
    url: string;
    domain: string;
    logoBase64?: string;
    faviconUrl?: string;
  }
): Promise<SaveLoginResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const currentDateTime = new Date().toISOString();

    // Build fields for the new item
    const fields = [];

    // Add URL field
    if (message.url) {
      fields.push(createSystemField(FieldKey.LoginUrl, { value: message.url }));
    }

    // Add username field
    if (message.username) {
      // Check if username looks like an email
      if (message.username.includes('@')) {
        fields.push(createSystemField(FieldKey.LoginEmail, { value: message.username }));
      } else {
        fields.push(createSystemField(FieldKey.LoginUsername, { value: message.username }));
      }
    }

    // Add password field
    if (message.password) {
      fields.push(createSystemField(FieldKey.LoginPassword, { value: message.password }));
    }

    // Get logo from base64, favicon URL, or undefined
    let logo: Uint8Array | undefined;

    // First try direct base64 if provided
    if (message.logoBase64) {
      try {
        logo = base64ToBytes(message.logoBase64);
      } catch {
        // Logo decode failed, continue without logo
      }
    }

    // If no direct logo, try fetching from favicon URL
    if (!logo && message.faviconUrl) {
      logo = await fetchFaviconAsBytes(message.faviconUrl);
    }

    // Create the new item
    const newItem: DraftItem = {
      Id: '', // Will be generated by SQLite
      Name: message.serviceName || message.domain,
      ItemType: ItemTypes.Login,
      Logo: logo,
      Fields: fields,
      CreatedAt: currentDateTime,
      UpdatedAt: currentDateTime
    };

    // Add the item to the vault
    await sqliteClient.items.create(newItem, [], []);

    // Persist locally and sync in the background (doesn't block when server is offline).
    await persistLocalVaultMutation(sqliteClient, encryptionKey);

    return { success: true, itemId: newItem.Id };
  } catch (error) {
    console.error('Failed to save login credential:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_CREATE_FAILED) };
  }
}

/**
 * Add a URL to an existing credential in the vault.
 * This is used when a user autofills from an existing credential on a new site
 * and wants to add that URL to the credential instead of creating a new one.
 *
 * @param message - The item ID and URL to add.
 * @returns Success status.
 */
export async function handleAddUrlToCredential(message: { itemId: string; url: string }): Promise<{ success: boolean; error?: string }> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const url = ServiceDetectionUtility.sanitizeUrl(message.url) || message.url;

    // Get the existing item
    const item = sqliteClient.items.getById(message.itemId);
    if (!item) {
      return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
    }

    // Find the existing URL field
    const urlFieldIndex = item.Fields?.findIndex(f => f.FieldKey === FieldKey.LoginUrl);

    if (urlFieldIndex !== undefined && urlFieldIndex >= 0) {
      const existingField = item.Fields![urlFieldIndex];
      const existingUrls = Array.isArray(existingField.Value) ? existingField.Value : (existingField.Value ? [existingField.Value] : []);

      /*
       * Compare on host only (subdomain + domain) so trailing slashes, paths,
       * query strings, fragments, `www.`, and http/https differences don't
       * cause us to store a near-duplicate URL on the credential.
       */
      if (await isUrlAlreadyLinked(existingUrls as string[], url)) {
        return { success: true };
      }

      // Add the new URL
      item.Fields![urlFieldIndex].Value = [...existingUrls, url];
    } else {
      // No URL field exists - create one
      const newUrlField = createSystemField(FieldKey.LoginUrl, { value: url });
      if (!item.Fields) {
        item.Fields = [];
      }
      item.Fields.push(newUrlField);
    }

    // Update the item's timestamp
    item.UpdatedAt = new Date().toISOString();

    // Update the item in the vault
    await sqliteClient.items.update(item, [], [], [], []);

    // Persist locally and sync in the background (doesn't block when server is offline).
    await persistLocalVaultMutation(sqliteClient, encryptionKey);

    return { success: true };
  } catch (error) {
    console.error('Failed to add URL to credential:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_UPDATE_FAILED) };
  }
}

/**
 * Check whether a URL is already linked (host-equivalent) to a credential.
 */
export async function handleIsUrlLinkedToCredential(message: { itemId: string; url: string }): Promise<{ linked: boolean }> {
  try {
    const encryptionKey = await handleGetEncryptionKey();
    if (!encryptionKey) {
      return { linked: false };
    }
    const sqliteClient = await createVaultSqliteClient();
    const item = sqliteClient.items.getById(message.itemId);
    if (!item) {
      return { linked: false };
    }
    const urlField = item.Fields?.find(f => f.FieldKey === FieldKey.LoginUrl);
    const existingUrls = urlField
      ? (Array.isArray(urlField.Value) ? urlField.Value : (urlField.Value ? [urlField.Value] : []))
      : [];
    const linked = await isUrlAlreadyLinked(existingUrls as string[], message.url);
    return { linked };
  } catch {
    return { linked: false };
  }
}

/**
 * Fetch a favicon from a URL and return it as a Uint8Array.
 * Returns undefined if the fetch fails or returns an invalid response.
 */
async function fetchFaviconAsBytes(url: string): Promise<Uint8Array | undefined> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'force-cache',
    });

    if (!response.ok) {
      return undefined;
    }

    // Check content type - should be an image
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.startsWith('image/')) {
      return undefined;
    }

    const arrayBuffer = await response.arrayBuffer();

    // Sanity check: favicon should be reasonably sized (< 1MB)
    if (arrayBuffer.byteLength > 1024 * 1024) {
      return undefined;
    }

    // Minimum size check - valid images should have some content
    if (arrayBuffer.byteLength < 10) {
      return undefined;
    }

    return new Uint8Array(arrayBuffer);
  } catch {
    // Fetch failed (network error, CORS, etc.)
    return undefined;
  }
}

/**
 * Get the login save feature settings.
 * Returns whether the feature is enabled and auto-dismiss timeout.
 */
export async function handleGetLoginSaveSettings(): Promise<{
  success: boolean;
  enabled: boolean;
  autoDismissSeconds: number;
  error?: string;
}> {
  try {
    const enabled = await LocalPreferencesService.getLoginSaveEnabled();
    const autoDismissSeconds = await LocalPreferencesService.getLoginSaveAutoDismissSeconds();

    return {
      success: true,
      enabled,
      autoDismissSeconds
    };
  } catch (error) {
    console.error('Error getting login save settings:', error);
    return { success: false, enabled: false, autoDismissSeconds: 15, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_READ_FAILED) };
  }
}

/**
 * Set the login save feature enabled state.
 *
 * @param enabled - Whether the feature should be enabled.
 */
export async function handleSetLoginSaveEnabled(
  enabled: boolean
): Promise<messageBoolResponse> {
  try {
    await LocalPreferencesService.setLoginSaveEnabled(enabled);
    return { success: true };
  } catch (error) {
    console.error('Error setting login save enabled:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.STORAGE_WRITE_FAILED) };
  }
}

/**
 * Get items that have TOTP codes, filtered by URL matching.
 * Used for TOTP autofill popup to show only items with 2FA codes.
 *
 * @param message - Filtering parameters: currentUrl, pageTitle, matchingMode
 */
export async function handleGetItemsWithTotp(
  message: { currentUrl: string, pageTitle: string, matchingMode?: string }
): Promise<messageItemsResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const allItems = sqliteClient.items.getAll();

    // Filter to only items with TOTP codes
    const itemsWithTotp = allItems.filter((item: Item) => item.HasTotp === true);

    // Then filter by URL matching using shared logic
    const filteredItems = await filterItemsByUrl(itemsWithTotp, message.currentUrl, message.pageTitle, message.matchingMode);

    // Prioritize recently selected item for multi-step login flows
    const rootDomain = await extractRootDomainFromUrl(message.currentUrl);
    const prioritized = await prioritizeRecentlySelectedItem(filteredItems, rootDomain, itemsWithTotp);

    return { success: true, items: prioritized.items, recentlySelectedId: prioritized.recentlySelectedId };
  } catch (error) {
    console.error('Error getting items with TOTP:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Search items that have TOTP codes by search term.
 * Used for TOTP autofill popup search functionality.
 *
 * @param message - Search parameters: searchTerm
 */
export async function handleSearchItemsWithTotp(
  message: { searchTerm: string }
): Promise<messageItemsResponse> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const allItems = sqliteClient.items.getAll();

    // Filter to only items with TOTP codes
    const itemsWithTotp = allItems.filter((item: Item) => item.HasTotp === true);

    // Then search using shared logic
    const searchResults = filterItemsBySearchTerm(itemsWithTotp, message.searchTerm);

    return { success: true, items: searchResults };
  } catch (error) {
    console.error('Error searching items with TOTP:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Get TOTP secret keys for items.
 * Used by content script to generate codes locally for live preview.
 *
 * @param message - Array of item IDs to get TOTP secrets for
 */
export async function handleGetTotpSecrets(
  message: { itemIds: string[] }
): Promise<{ success: boolean; secrets?: Record<string, TotpSecret>; error?: string }> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const secrets: Record<string, TotpSecret> = {};

    for (const itemId of message.itemIds) {
      const totpCodes = sqliteClient.items.getTotpCodesForItem(itemId);
      if (totpCodes.length > 0) {
        const totpCode = totpCodes[0];
        secrets[itemId] = {
          SecretKey: totpCode.SecretKey,
          Algorithm: totpCode.Algorithm,
          Digits: totpCode.Digits,
          Period: totpCode.Period
        };
      }
    }

    return { success: true, secrets };
  } catch (error) {
    console.error('Error getting TOTP secrets:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Generate a TOTP code for a specific item.
 * Used by content script to fill TOTP fields.
 *
 * @param message - The item ID to generate TOTP code for
 */
export async function handleGenerateTotpCode(
  message: { itemId: string }
): Promise<{ success: boolean; code?: string; error?: string }> {
  const encryptionKey = await handleGetEncryptionKey();

  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  try {
    const sqliteClient = await createVaultSqliteClient();
    const totpCodes = sqliteClient.items.getTotpCodesForItem(message.itemId);

    if (totpCodes.length === 0) {
      return { success: false, error: 'No TOTP codes found for this item' };
    }

    const code = generateTotpCode(totpCodes[0].SecretKey, totpCodes[0]);
    if (!code) {
      return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
    }

    return { success: true, code };
  } catch (error) {
    console.error('Error generating TOTP code:', error);
    return { success: false, error: formatErrorWithCode(await t('common.errors.unknownError'), AppErrorCode.ITEM_READ_FAILED) };
  }
}

/**
 * Record one use of an item: when it was last used, and how often.
 * @param message - The item that was used and what was done with it.
 */
export async function handleRecordItemUsage(
  message: { itemId: string; action: ItemUsageAction }
): Promise<{ success: boolean }> {
  try {
    const encryptionKey = await handleGetEncryptionKey();
    if (!encryptionKey) {
      return { success: false };
    }

    const sqliteClient = await createVaultSqliteClient();
    if (!sqliteClient.itemStats.recordUsage(message.itemId, message.action)) {
      // No such item (deleted between use and record); nothing to attribute the use to.
      return { success: false };
    }

    await persistLocalVaultMutation(sqliteClient, encryptionKey, VaultDataBucketCategory.Stats);
    return { success: true };
  } catch (error) {
    console.error('Failed to record item usage:', error);
    return { success: false };
  }
}

/**
 * Set recently selected item for smart autofill.
 */
export async function handleSetRecentlySelected(
  message: { itemId: string; domain: string }
): Promise<{ success: boolean }> {
  try {
    const rootDomain = await extractRootDomain(message.domain);
    await RecentlySelectedItemService.setRecentlySelected(message.itemId, rootDomain);
    return { success: true };
  } catch (error) {
    console.error('Error setting recently selected item:', error);
    return { success: false };
  }
}

/**
 * Get recently selected item for smart autofill.
 */
export async function handleGetRecentlySelected(
  message: { domain: string }
): Promise<{ success: boolean; itemId?: string | null }> {
  try {
    const rootDomain = await extractRootDomain(message.domain);
    const itemId = await RecentlySelectedItemService.getRecentlySelected(rootDomain);
    return { success: true, itemId };
  } catch (error) {
    console.error('Error getting recently selected item:', error);
    return { success: false, itemId: null };
  }
}

/**
 * Create another shared manifest for a family, with this account as its first member.
 *
 * @param message - the family to create the vault for and the name to give it.
 */
export async function handleGroupCreateVault(message: { groupId: string; name: string }): Promise<{ success: boolean; error?: string; apiErrorCode?: string }> {
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  const name = message.name.trim();
  if (name.length === 0) {
    return { success: false, error: await t('sharing.family.errors.createVaultFailed') };
  }

  try {
    const webApi = new WebApiService();
    const overview = await SharingService.getOverview(webApi);
    const group = overview.groups.find(candidate => candidate.groupId.toLowerCase() === message.groupId.toLowerCase());

    if (!group || group.role === 'Member') {
      console.error(`Failed to create shared manifest: group ${message.groupId} is not one this account administers.`);
      return { success: false, error: await t('sharing.family.errors.createVaultFailed') };
    }

    // The new vault's VEK is encrypted for this client's own account public key.
    const selfPublicKey = await VaultKeyService.getAccountPublicKey();
    if (!selfPublicKey) {
      return { success: false, error: await t('sharing.family.errors.vaultUpgradeRequired') };
    }

    const sqliteClient = await createVaultSqliteClient();
    if (await vaultRequiresManifestMigration(sqliteClient)) {
      return { success: false, error: await t('sharing.family.errors.vaultUpgradeRequired') };
    }

    // The name stays on this device: it rides into the vault below, never into the create request.
    const mapping = await SharingService.createSharedManifest(webApi, {
      groupId: group.groupId,
      selfPublicKey,
    }, crypto.randomUUID().toUpperCase());

    await SharingService.addSharedManifestRecord({
      manifestId: mapping.manifestId,
      encryptedVek: mapping.encryptedVek,
      encryptionPublicKey: mapping.encryptionPublicKey,
      algorithm: mapping.algorithm,
      salt: mapping.salt,
      name,
      canAdminister: true,
    }, encryptionKey);

    await recordManifestRevisions({ [mapping.manifestId]: mapping.revision });
    await multiManifestRendering.render(sqliteClient, mapping.manifestId, name);

    // Mail to an alias in this vault is encrypted with the vault's own keypair, which is what makes it readable by every member.
    await SharingService.rotateManifestEncryptionKey(sqliteClient, mapping.manifestId);
    await persistLocalVaultMutation(sqliteClient, encryptionKey);

    devLog(`[Sharing] Created shared manifest ${mapping.manifestId} ("${name}") for group ${group.groupId}.`);
    return { success: true };
  } catch (error) {
    console.error('Failed to create shared manifest:', error);
    if (error instanceof ApiRequestError && error.apiErrorCode) {
      return { success: false, apiErrorCode: error.apiErrorCode };
    }

    /*
     * Everything this can fail on (a vault that will not open, a key that will not import, a server that refuses
     * without a code) collapses into the same sentence otherwise, which leaves nothing to act on. The cause is
     * appended the way the upload path does it.
     */
    const detail = error instanceof Error && error.message.length > 0 ? ` [${error.message}]` : '';
    return { success: false, error: `${await t('sharing.family.errors.createVaultFailed')}${detail}` };
  }
}

/**
 * Invite a member of a family to one of its shared manifests, handing them the vault's key sealed for them.
 *
 * The recipient is picked off the family's own roster, so this never names an account outside the family.
 * @param message - the family, the vault, and the member being invited.
 */
export async function handleGroupInviteMember(message: { groupId: string; manifestId: string; userId: string }): Promise<{ success: boolean; error?: string; apiErrorCode?: string }> {
  const encryptionKey = await handleGetEncryptionKey();
  if (!encryptionKey) {
    return { success: false, error: formatErrorWithCode(await t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
  }

  /**
   * Fail the invite with a reason.
   * @param reason - what was missing.
   */
  const failed = async (reason: string): Promise<{ success: boolean; error: string }> => {
    devWarn(`[Sharing] Could not invite ${message.userId} to vault ${message.manifestId}: ${reason}.`);
    return { success: false, error: `${await t('sharing.family.errors.inviteFailed')} [${reason}]` };
  };

  try {
    const webApi = new WebApiService();
    const overview = await SharingService.getOverview(webApi);
    const group = overview.groups.find(candidate => candidate.groupId.toLowerCase() === message.groupId.toLowerCase());
    const manifest = group?.manifests.find(candidate => candidate.manifestId.toLowerCase() === message.manifestId.toLowerCase());
    const member = group?.members.find(candidate => candidate.userId === message.userId);

    if (!group || group.role === 'Member') {
      return failed('not an administrator of the group');
    }

    if (!manifest) {
      return failed('the vault does not belong to the group');
    }

    if (!member) {
      return failed('the recipient is not a member of the group');
    }

    if (!member.publicKey) {
      return { success: false, apiErrorCode: 'INVITE_RECIPIENT_NOT_READY' };
    }

    // Find this account's own grant on the vault: a key that was never handed to this account cannot be passed on.
    let record = await SharingService.getSharedManifestRecord(manifest.manifestId);
    if (!record) {
      // Backstop: the records persist next to the vault, so a missing one means a desync only a pull repairs.
      devWarn(`[Sharing] No key record stored for vault ${manifest.manifestId}; pulling to re-record it before inviting.`);
      await handleFullVaultSync({ forcePull: true });
      record = await SharingService.getSharedManifestRecord(manifest.manifestId);
    }

    if (!record) {
      return failed('this account holds no key for the vault');
    }

    const sqliteClient = await createVaultSqliteClient();
    const manifestVek = await SharingService.openSharedManifestVek(sqliteClient, record);
    if (!manifestVek) {
      return failed('the key of the vault did not open');
    }

    const vaultName = multiManifestRendering.displayNames(sqliteClient)[manifest.manifestId.toLowerCase()] ?? record.name ?? null;
    const grant = await SharingService.encryptVekFor(manifestVek, member, vaultName);
    if (!grant) {
      return { success: false, apiErrorCode: 'INVITE_RECIPIENT_NOT_READY' };
    }

    await SharingService.inviteMember(webApi, group.groupId, manifest.manifestId, member.userId, grant, VaultKeyAlgorithm.RsaOaepSha256);

    devLog(`[Sharing] Invited ${member.userId} to vault ${manifest.manifestId} with its key encrypted for them.`);
    return { success: true };
  } catch (error) {
    if (error instanceof ApiRequestError && error.apiErrorCode) {
      return { success: false, apiErrorCode: error.apiErrorCode };
    }

    console.error('Failed to invite member to shared manifest:', error);
    return { success: false, error: await t('sharing.family.errors.inviteFailed') };
  }
}

/**
 * Take a member's access to one shared manifest away, or hand back one's own.
 *
 * @param message - the family, the vault, and the member losing access.
 */
export async function handleGroupRevokeAccess(message: { groupId: string; manifestId: string; userId: string }): Promise<{ success: boolean; error?: string; apiErrorCode?: string }> {
  try {
    const webApi = new WebApiService();
    await SharingService.revokeAccess(webApi, message.groupId, message.manifestId, message.userId);

    devLog(`[Sharing] Revoked ${message.userId}'s access to vault ${message.manifestId}; syncing to pick up whatever the server left for this client to finish.`);
    void handleFullVaultSync().catch(error => console.error('Background sync after a vault access change failed:', error));

    return { success: true };
  } catch (error) {
    if (error instanceof ApiRequestError && error.apiErrorCode) {
      return { success: false, apiErrorCode: error.apiErrorCode };
    }

    console.error('Failed to revoke shared manifest access:', error);
    return { success: false, error: await t('sharing.family.errors.revokeAccessFailed') };
  }
}
