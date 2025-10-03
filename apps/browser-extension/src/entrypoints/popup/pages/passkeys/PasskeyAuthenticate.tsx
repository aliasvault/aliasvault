import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { sendMessage } from 'webext-bridge/popup';

import Button from '@/entrypoints/popup/components/Button';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useVaultLockRedirect } from '@/entrypoints/popup/hooks/useVaultLockRedirect';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import { PasskeyAuthenticator } from '@/utils/passkey/PasskeyAuthenticator';
import { PasskeyHelper } from '@/utils/passkey/PasskeyHelper';
import type { GetRequest, PasskeyGetCredentialResponse, PendingPasskeyGetRequest, StoredPasskeyRecord } from '@/utils/passkey/types';

/**
 * PasskeyAuthenticate
 */
const PasskeyAuthenticate: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { setIsInitialLoading } = useLoading();
  const dbContext = useDb();
  const { executeVaultMutation } = useVaultMutate();
  const [request, setRequest] = useState<PendingPasskeyGetRequest | null>(null);
  const [selectedPasskey, setSelectedPasskey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availablePasskeys, setAvailablePasskeys] = useState<Array<{ id: string; displayName: string; username?: string | null }>>([]);
  const { isLocked } = useVaultLockRedirect();

  useEffect(() => {
    /**
     * fetchRequestData
     */
    const fetchRequestData = async () : Promise<void> => {
      // Wait for DB to be initialized
      if (!dbContext.dbInitialized) {
        return;
      }

      // If vault is locked, the hook will handle redirect, we just return
      if (isLocked) {
        return;
      }

      // Get the requestId from URL
      const params = new URLSearchParams(location.search);
      const requestId = params.get('requestId');

      if (requestId) {
        try {
          // Fetch the full request data from background
          const data = await sendMessage('GET_REQUEST_DATA', { requestId }, 'background') as unknown as PendingPasskeyGetRequest;

          if (data && data.type === 'get') {
            setRequest(data);

            // Get passkeys for this rpId from the vault
            const rpId = data.publicKey.rpId || new URL(data.origin).hostname;
            const passkeys = dbContext.sqliteClient!.getPasskeysByRpId(rpId);

            // Filter by allowCredentials if specified
            let filteredPasskeys = passkeys;
            if (data.publicKey.allowCredentials && data.publicKey.allowCredentials.length > 0) {
              // Convert the RP's base64url credential IDs to GUIDs for comparison
              const allowedGuids = new Set(
                data.publicKey.allowCredentials.map(c => {
                  try {
                    return PasskeyHelper.base64urlToGuid(c.id);
                  } catch (e) {
                    console.warn('Failed to convert credential ID to GUID:', c.id, e);
                    return null;
                  }
                }).filter((id): id is string => id !== null)
              );
              filteredPasskeys = passkeys.filter(pk => allowedGuids.has(pk.Id));
            }

            // Map to display format
            setAvailablePasskeys(filteredPasskeys.map(pk => ({
              id: pk.Id,
              displayName: pk.DisplayName,
              username: pk.Username
            })));
          }
        } catch (error) {
          console.error('Failed to fetch request data:', error);
          setError(t('common.errors.unknownError'));
        }
      }

      // Mark initial loading as complete
      setIsInitialLoading(false);
    };

    fetchRequestData();
  }, [location, setIsInitialLoading, dbContext.dbInitialized, isLocked, dbContext.sqliteClient, t]);

  /**
   * Handle passkey authentication
   */
  const handleUsePasskey = async (passkeyId: string) : Promise<void> => {
    if (!request || !dbContext.sqliteClient) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Get the stored passkey from vault
      const storedPasskey = dbContext.sqliteClient.getPasskeyById(passkeyId);
      if (!storedPasskey) {
        throw new Error(t('common.errors.unknownError'));
      }

      // Parse the stored keys
      const publicKey = JSON.parse(storedPasskey.PublicKey) as JsonWebKey;
      const privateKey = JSON.parse(storedPasskey.PrivateKey) as JsonWebKey;

      // Build the stored record for the provider
      const storedRecord: StoredPasskeyRecord = {
        rpId: storedPasskey.RpId,
        credentialId: PasskeyHelper.guidToBase64url(storedPasskey.Id),
        publicKey,
        privateKey,
        userId: storedPasskey.UserId,
        userName: storedPasskey.Username ?? undefined,
        userDisplayName: storedPasskey.ServiceName ?? undefined
      };

      // Build the GetRequest
      const getRequest: GetRequest = {
        origin: request.origin,
        requestId: request.requestId,
        publicKey: {
          rpId: request.publicKey.rpId,
          challenge: request.publicKey.challenge,
          userVerification: request.publicKey.userVerification
        }
      };

      // Get the assertion using the static method
      const credential: PasskeyGetCredentialResponse = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord, {
        uvPerformed: true, // TODO: implement explicit user verification check
        includeBEBS: true // Backup eligible/state - defaults to true
      });

      console.info('PasskeyAuthenticate: Received assertion successfully', credential);

      // Send response back
      await sendMessage('PASSKEY_POPUP_RESPONSE', {
        requestId: request.requestId,
        credential
      }, 'background');

      // Auto-close window on success
      window.close();
    } catch (error) {
      console.error('PasskeyAuthenticate: Error during authentication', error);
      setLoading(false);
      setError(t('common.errors.unknownError'));
    }
  };

  /**
   * Handle passkey deletion
   */
  const handleDeletePasskey = async (passkeyId: string, event: React.MouseEvent) : Promise<void> => {
    event.stopPropagation(); // Prevent triggering authentication

    if (!confirm(t('passkeys.authenticate.deleteConfirm'))) {
      return;
    }

    if (!dbContext.sqliteClient) {
      return;
    }

    try {
      // Delete via vault mutation to sync changes
      await executeVaultMutation(
        async () => {
          await dbContext.sqliteClient!.deletePasskeyById(passkeyId);
        },
        {
          /**
           * onSuccess
           */
          onSuccess: () => {
            // Remove from UI
            setAvailablePasskeys(prev => prev.filter(pk => pk.id !== passkeyId));

            // Clear selection if the deleted passkey was selected
            if (selectedPasskey === passkeyId) {
              setSelectedPasskey(null);
            }
          },
          /**
           * onError
           */
          onError: (err) => {
            console.error('Failed to delete passkey:', err);
            setError(t('common.errors.unknownError'));
          }
        }
      );
    } catch (error) {
      console.error('Failed to delete passkey:', error);
      setError(t('common.errors.unknownError'));
    }
  };

  /**
   * Handle fallback
   */
  const handleFallback = async () : Promise<void> => {
    if (!request) {
      return;
    }

    // Tell background to use native implementation
    await sendMessage('PASSKEY_POPUP_RESPONSE', {
      requestId: request.requestId,
      fallback: true
    }, 'background');

    window.close();
  };

  /**
   * Handle cancel
   */
  const handleCancel = async () : Promise<void> => {
    if (!request) {
      return;
    }

    // Tell background user cancelled
    await sendMessage('PASSKEY_POPUP_RESPONSE', {
      requestId: request.requestId,
      cancelled: true
    }, 'background');

    window.close();
  };

  if (!request) {
    return (
      <div className="flex justify-center py-8">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          {t('passkeys.authenticate.title')}
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('passkeys.authenticate.signInFor')} <strong>{request.origin}</strong>
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      <div className="space-y-4">
        {availablePasskeys && availablePasskeys.length > 0 ? (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('passkeys.authenticate.selectPasskey')}
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto border rounded-lg p-2 bg-gray-50 dark:bg-gray-800">
              {availablePasskeys.map((pk) => (
                <div
                  key={pk.id}
                  className="relative group p-3 rounded-lg border cursor-pointer transition-colors bg-white border-gray-200 hover:bg-blue-50 hover:border-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-blue-900 dark:hover:border-blue-700"
                  onClick={() => !loading && handleUsePasskey(pk.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                        {pk.displayName}
                      </div>
                      {pk.username && (
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          {pk.username}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => handleDeletePasskey(pk.id, e)}
                      className="flex-shrink-0 p-1.5 text-gray-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      title={t('passkeys.authenticate.deletePasskey')}
                      disabled={loading}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-8 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <p className="text-gray-600 dark:text-gray-400">
              {t('passkeys.authenticate.noPasskeysFound')}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Button
          variant="secondary"
          onClick={handleFallback}
        >
          {t('passkeys.authenticate.useBrowserPasskey')}
        </Button>

        <Button
          variant="secondary"
          onClick={handleCancel}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
};

export default PasskeyAuthenticate;
