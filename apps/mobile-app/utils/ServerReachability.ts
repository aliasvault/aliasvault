import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Whether the server is unreachable, per the same status check the vault sync runs before syncing.
 */
export async function isServerUnreachable(): Promise<boolean> {
  try {
    return (await NativeVaultManager.checkSyncStatus()).isOffline;
  } catch {
    return false;
  }
}
