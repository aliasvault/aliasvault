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
 * The deep link to the import screen when another app's export cold-started the app, else null.
 */
export async function pendingImportDeepLink(): Promise<string | null> {
  // Credential exchange is only implemented for iOS currently.
  if (Platform.OS !== 'ios') {
    return null;
  }
  try {
    return (await NativeVaultManager.credentialExchangeHasPendingImport()) ? 'aliasvault://open/credential-exchange-import' : null;
  } catch {
    return null;
  }
}
