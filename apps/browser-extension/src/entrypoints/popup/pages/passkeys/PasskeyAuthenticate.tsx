import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { sendMessage } from 'webext-bridge/popup';

import { extractDomain, extractRootDomain } from '@/entrypoints/contentScript/Filter';
import Button from '@/entrypoints/popup/components/Button';
import PasskeyBypassDialog from '@/entrypoints/popup/components/Dialogs/PasskeyBypassDialog';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useVaultLockRedirect } from '@/entrypoints/popup/hooks/useVaultLockRedirect';

import { PASSKEY_DISABLED_SITES_KEY } from '@/utils/Constants';
import { PasskeyAuthenticator } from '@/utils/passkey/PasskeyAuthenticator';
import { PasskeyHelper } from '@/utils/passkey/PasskeyHelper';
import type { GetRequest, PasskeyGetCredentialResponse, PendingPasskeyGetRequest, StoredPasskeyRecord } from '@/utils/passkey/types';

import { storage } from "#imports";

/**
 * PasskeyAuthenticate
 */
const PasskeyAuthenticate: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { setIsInitialLoading } = useLoading();
  const dbContext = useDb();
  const [request, setRequest] = useState<PendingPasskeyGetRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availablePasskeys, setAvailablePasskeys] = useState<Array<{ id: string; displayName: string; rpId: string; serviceName?: string | null }>>([]);
  const [showBypassDialog, setShowBypassDialog] = useState(false);
  const { isLocked } = useVaultLockRedirect();
  const firstPasskeyRef = useRef<HTMLDivElement>(null);

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
              serviceName: pk.ServiceName,
              rpId: pk.RpId,
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

  // Auto-focus first passkey
  useEffect(() => {
    if (availablePasskeys.length > 0 && firstPasskeyRef.current) {
      firstPasskeyRef.current.focus();
    }
  }, [availablePasskeys.length]);

  // Handle Enter key to select first passkey
  useEffect(() => {
    /**
     * Handle Enter key to select first passkey
     */
    const handleKeyDown = (e: KeyboardEvent) : void => {
      if (e.key === 'Enter' && !loading && availablePasskeys.length > 0) {
        handleUsePasskey(availablePasskeys[0].id);
      }
    };

    /**
     * Handle Enter key to select first passkey
     */
    window.addEventListener('keydown', handleKeyDown);
    return () : void => window.removeEventListener('keydown', handleKeyDown);

    /**
     * Handle Enter key to select first passkey
     */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, availablePasskeys]);

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

      // Extract PRF secret from PrfKey if available
      let prfSecret: string | undefined;

      if (storedPasskey.PrfKey) {
        try {
          // Convert PrfKey bytes to base64url string
          prfSecret = PasskeyHelper.bytesToBase64url(storedPasskey.PrfKey);
        } catch (e) {
          console.warn('Failed to convert PrfKey to base64url', e);
        }
      }

      // Build the stored record for the provider
      const storedRecord: StoredPasskeyRecord = {
        rpId: storedPasskey.RpId,
        credentialId: PasskeyHelper.guidToBase64url(storedPasskey.Id),
        publicKey,
        privateKey,
        userId: storedPasskey.UserId,
        userName: storedPasskey.Username ?? undefined,
        userDisplayName: storedPasskey.ServiceName ?? undefined,
        prfSecret
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

      // Extract PRF inputs if requested
      let prfInputs: { first: ArrayBuffer | Uint8Array; second?: ArrayBuffer | Uint8Array } | undefined;
      if (request.publicKey.extensions?.prf?.eval) {
        // Handle numeric object format (serialized Uint8Array through events)
        const firstInput = request.publicKey.extensions.prf.eval.first;
        let firstBytes: Uint8Array;

        if (typeof firstInput === 'object' && firstInput !== null && !Array.isArray(firstInput)) {
          // Numeric object format: {0: 68, 1: 204, ...}
          const keys = Object.keys(firstInput).map(Number).sort((a, b) => a - b);
          firstBytes = new Uint8Array(keys.length);
          for (let i = 0; i < keys.length; i++) {
            firstBytes[i] = (firstInput as unknown as Record<string, number>)[i];
          }
        } else if (typeof firstInput === 'string') {
          // Base64 string format
          const firstDecoded = atob(firstInput);
          firstBytes = new Uint8Array(firstDecoded.length);
          for (let i = 0; i < firstDecoded.length; i++) {
            firstBytes[i] = firstDecoded.charCodeAt(i);
          }
        } else {
          throw new Error('Unknown PRF input format');
        }

        prfInputs = { first: firstBytes };

        if (request.publicKey.extensions.prf.eval.second) {
          const secondInput = request.publicKey.extensions.prf.eval.second;
          let secondBytes: Uint8Array;

          if (typeof secondInput === 'object' && secondInput !== null && !Array.isArray(secondInput)) {
            const keys = Object.keys(secondInput).map(Number).sort((a, b) => a - b);
            secondBytes = new Uint8Array(keys.length);
            for (let i = 0; i < keys.length; i++) {
              secondBytes[i] = (secondInput as unknown as Record<string, number>)[i];
            }
          } else if (typeof secondInput === 'string') {
            const secondDecoded = atob(secondInput);
            secondBytes = new Uint8Array(secondDecoded.length);
            for (let i = 0; i < secondDecoded.length; i++) {
              secondBytes[i] = secondDecoded.charCodeAt(i);
            }
          } else {
            console.error('[PasskeyAuth] Unknown PRF second input type:', typeof secondInput);
            throw new Error('Unknown PRF second input format');
          }

          prfInputs.second = secondBytes;
        }
      }

      // Get the assertion using the static method
      const assertion = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord, {
        uvPerformed: true, // TODO: implement explicit user verification check
        includeBEBS: true, // Backup eligible/state - defaults to true
        prfInputs
      });

      // Convert PRF results to base64 for transport
      let prfResults: { first: string; second?: string } | undefined;
      if (assertion.prfResults) {
        prfResults = {
          first: PasskeyHelper.arrayBufferToBase64(assertion.prfResults.first)
        };
        if (assertion.prfResults.second) {
          prfResults.second = PasskeyHelper.arrayBufferToBase64(assertion.prfResults.second);
        }
      }

      const credential: PasskeyGetCredentialResponse = {
        id: assertion.id,
        rawId: assertion.rawId,
        clientDataJSON: assertion.clientDataJSON,
        authenticatorData: assertion.authenticatorData,
        signature: assertion.signature,
        userHandle: assertion.userHandle,
        prfResults
      };

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
   * Handle fallback - show bypass dialog first
   */
  const handleFallback = async () : Promise<void> => {
    setShowBypassDialog(true);
  };

  /**
   * Handle bypass choice
   */
  const handleBypassChoice = async (choice: 'once' | 'always') : Promise<void> => {
    if (!request) {
      return;
    }

    if (choice === 'always') {
      // Add to permanent disabled list
      const hostname = new URL(request.origin).hostname;
      const baseDomain = extractRootDomain(extractDomain(hostname));

      const disabledSites = await storage.getItem(PASSKEY_DISABLED_SITES_KEY) as string[] ?? [];
      if (!disabledSites.includes(baseDomain)) {
        disabledSites.push(baseDomain);
        await storage.setItem(PASSKEY_DISABLED_SITES_KEY, disabledSites);
      }
    }
    // For 'once', we don't store anything - just bypass this one time

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
    <>
      {showBypassDialog && request && (
        <PasskeyBypassDialog
          origin={new URL(request.origin).hostname}
          onChoice={handleBypassChoice}
          onCancel={() => setShowBypassDialog(false)}
        />
      )}

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
                {availablePasskeys.map((pk, index) => (
                  <div
                    key={pk.id}
                    ref={index === 0 ? firstPasskeyRef : null}
                    tabIndex={0}
                    className="p-3 rounded-lg border cursor-pointer transition-colors bg-white border-gray-200 hover:bg-gray-100 hover:border-gray-300 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600 dark:hover:border-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                    onClick={() => !loading && handleUsePasskey(pk.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !loading) {
                        handleUsePasskey(pk.id);
                      }
                    }}
                  >
                    <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                      {pk.displayName}
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                      <span className="truncate">{pk.serviceName}</span>
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
    </>
  );
};

export default PasskeyAuthenticate;
