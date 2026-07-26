import { VaultKeyService } from '@/utils/VaultKeyService';

/**
 * One-time KEK/VEK migration: vaults created before the vault key existed have to create one, which happens as
 * part of their next full push (see `handleUploadVault`).
 *
 * TODO: this file is the legacy part of the /manifest-migration gate. This can be deleted once all users have 
 * migrated to the manifest-v1 storage model.
 */
export async function requiresLegacyVaultKeyMigration(): Promise<boolean> {
  return !await VaultKeyService.hasLocalVaultKey();
}
