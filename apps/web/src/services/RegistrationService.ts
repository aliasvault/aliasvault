import { SrpLoginService } from '@aliasvault/client/auth/SrpLoginService';
import { VaultKeyService } from '@aliasvault/client/auth/VaultKeyService';
import { UnlockMethodType } from '@aliasvault/models/webapi';

import { vaultStore } from '@/vault/VaultStore';

import type { WebApiService } from '@aliasvault/client/api/WebApiService';

/**
 * Registration: create the account. The first sync writes the empty vault.
 */
export const RegistrationService = {
  /**
   * Register an account.
   * @param setAuthTokens - stores the username and tokens (the app context's setter, so the UI state follows)
   * @param inviteCode - the registration invite code, required when public registration is disabled
   * @throws ApiRequestError with the server's error code when the server refuses the registration
   */
  async register(webApi: WebApiService, username: string, password: string, setAuthTokens: (username: string, accessToken: string, refreshToken: string) => Promise<void>, inviteCode?: string): Promise<void> {
    const registered = await new SrpLoginService(webApi).register(username, password, inviteCode);

    await setAuthTokens(registered.username, registered.token.token, registered.token.refreshToken);
    await VaultKeyService.cacheVaultKeyBlobs({ type: UnlockMethodType.Password, ...registered.keys.accountKeys, ...registered.derivationParams });
    await vaultStore.storeUnlockKeyDerivationParams(registered.derivationParams);
    await vaultStore.storeAccountKey(registered.derivedKey);
  },
};
