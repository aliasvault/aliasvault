/**
 * Registers the extension platform with the client core.
 */

import { setPlatform } from '@aliasvault/client/platform';
import { VaultMergeService } from '@aliasvault/client/sync/VaultMergeService';
import { VaultSyncService } from '@aliasvault/client/sync/VaultSyncService';

import { extensionPlatform } from '@/platform/ExtensionPlatform';

setPlatform(extensionPlatform);

/** The vault sync service. */
export const vaultSyncService = new VaultSyncService();

/** The legacy sqlite-blob merge and trash pruning service. TODO: remove this when old sqlite-blob support is removed. */
export const vaultMergeService = new VaultMergeService();
