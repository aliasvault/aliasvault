import { Platform } from 'react-native';

import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * What the exporter counted.
 */
export type CredentialExchangeExportCounts = {
  itemCount: number;
  passkeyCount: number;
  totpCount: number;
};

/**
 * Whether this device can transfer credentials with another app. Currently supported:
 * - iOS 26+
 */
export const isCredentialExchangeAvailable = Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 26;

/**
 * The deep link to the import screen when another app's export cold-started the app, else null.
 */
export async function pendingImportDeepLink(): Promise<string | null> {
  if (!isCredentialExchangeAvailable) {
    return null;
  }
  try {
    return (await NativeVaultManager.credentialExchangeHasPendingImport()) ? 'aliasvault://open/credential-exchange-import' : null;
  } catch {
    return null;
  }
}
