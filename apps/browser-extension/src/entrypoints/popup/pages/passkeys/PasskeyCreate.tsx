import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { sendMessage } from 'webext-bridge/popup';

import { extractDomain, extractRootDomain } from '@/entrypoints/contentScript/CredentialMatcher';
import Alert from '@/entrypoints/popup/components/Alert';
import Button from '@/entrypoints/popup/components/Button';
import PasskeyBypassDialog from '@/entrypoints/popup/components/Dialogs/PasskeyBypassDialog';
import { FormInput } from '@/entrypoints/popup/components/Forms/FormInput';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { useVaultLockRedirect } from '@/entrypoints/popup/hooks/useVaultLockRedirect';
import { useVaultMutate } from '@/entrypoints/popup/hooks/useVaultMutate';

import { PASSKEY_DISABLED_SITES_KEY } from '@/utils/Constants';
import type { Passkey } from '@/utils/dist/shared/models/vault';
import { PasskeyAuthenticator } from '@/utils/passkey/PasskeyAuthenticator';
import { PasskeyHelper } from '@/utils/passkey/PasskeyHelper';
import type { CreateRequest, PasskeyCreateCredentialResponse, PendingPasskeyCreateRequest } from '@/utils/passkey/types';

import { storage } from "#imports";

/**
 * PasskeyCreate
 */
const PasskeyCreate: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { setIsInitialLoading } = useLoading();
  const dbContext = useDb();
  const webApi = useWebApi();
  const { executeVaultMutation, isLoading: isMutating, syncStatus } = useVaultMutate();
  const [request, setRequest] = useState<PendingPasskeyCreateRequest | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { isLocked } = useVaultLockRedirect();
  const [existingPasskeys, setExistingPasskeys] = useState<Array<Passkey & { Username?: string | null; ServiceName?: string | null }>>([]);
  const [selectedPasskeyToReplace, setSelectedPasskeyToReplace] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);
  const [showBypassDialog, setShowBypassDialog] = useState(false);
  const createNewButtonRef = useRef<HTMLButtonElement>(null);
  const displayNameInputRef = useRef<HTMLInputElement>(null);

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
          const data = await sendMessage('GET_REQUEST_DATA', { requestId }, 'background') as unknown as PendingPasskeyCreateRequest;
          if (data && data.type === 'create') {
            setRequest(data);

            /**
             * Set default displayName: use rp.name if available, otherwise use rpId
             * This aligns with iOS/Android behavior
             */
            const defaultName = data.publicKey?.rp?.name || data.publicKey?.rp?.id || 'Passkey';
            setDisplayName(defaultName);

            // Check for existing passkeys for this RP ID and user
            if (dbContext.sqliteClient && data.publicKey?.rp?.id) {
              const allPasskeysForRpId = dbContext.sqliteClient.getPasskeysByRpId(data.publicKey.rp.id);

              /**
               * Filter by user ID and/or username if provided
               * This allows for multiple users on the same site
               */
              let filtered = allPasskeysForRpId;

              if (data.publicKey.user?.id || data.publicKey.user?.name) {
                filtered = allPasskeysForRpId.filter(passkey => {
                  /**
                   * Match by user handle if both are available
                   * The request has base64url encoded user.id, passkey has UserHandle as byte array
                   * Convert request's user.id to bytes for comparison
                   */
                  if (data.publicKey.user?.id && passkey.UserHandle) {
                    try {
                      const requestUserIdBytes = PasskeyHelper.base64urlToBytes(data.publicKey.user.id);
                      const passkeyUserHandle = passkey.UserHandle instanceof Uint8Array ? passkey.UserHandle : new Uint8Array(passkey.UserHandle);

                      // Compare byte arrays
                      if (requestUserIdBytes.length === passkeyUserHandle.length &&
                          requestUserIdBytes.every((byte, idx) => byte === passkeyUserHandle[idx])) {
                        return true;
                      }
                    } catch {
                      // If conversion fails, skip this passkey
                    }
                  }

                  // Also match by username if available (from the credential)
                  if (data.publicKey.user?.name && passkey.Username) {
                    if (passkey.Username === data.publicKey.user.name) {
                      return true;
                    }
                  }

                  // If neither user ID nor username match, exclude this passkey
                  return false;
                });
              }

              setExistingPasskeys(filtered);
              // If no existing passkeys for this user, go straight to create form
              if (filtered.length === 0) {
                setShowCreateForm(true);
              }
            }
          }
        } catch (error) {
          console.error('Failed to fetch request data:', error);
          setError(t('common.errors.unknownError'));
        }
      }

      setIsInitialLoading(false);
    };

    fetchRequestData();
  }, [location, setIsInitialLoading, dbContext.dbInitialized, dbContext.sqliteClient, isLocked, t]);

  // Auto-focus create new button or input field
  useEffect(() => {
    if (showCreateForm && displayNameInputRef.current) {
      displayNameInputRef.current.focus();
    } else if (!showCreateForm && existingPasskeys.length > 0 && createNewButtonRef.current) {
      createNewButtonRef.current.focus();
    }
  }, [showCreateForm, existingPasskeys.length]);

  // Handle Enter key to submit
  useEffect(() => {
    /**
     * Handle Enter key to submit
     */
    const handleKeyDown = (e: KeyboardEvent) : void => {
      if (e.key === 'Enter' && !localLoading && !isMutating) {
        if (showCreateForm) {
          handleCreate();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () : void => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCreateForm, localLoading, isMutating]);

  /**
   * Handle when user clicks "Create New Passkey" button
   */
  const handleCreateNew = () : void => {
    setSelectedPasskeyToReplace(null);
    setShowCreateForm(true);
  };

  /**
   * Handle when user selects an existing passkey to replace
   */
  const handleSelectReplace = (passkeyId: string) : void => {
    setSelectedPasskeyToReplace(passkeyId);
    setShowCreateForm(true);
  };

  /**
   * Handle passkey creation
   */
  const handleCreate = async () : Promise<void> => {
    if (!request || !dbContext.sqliteClient) {
      return;
    }

    setError(null);

    try {
      // Extract favicon from origin URL
      let faviconLogo: Uint8Array | undefined = undefined;
      if (request.origin) {
        setLocalLoading(true);
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Favicon extraction timed out')), 5000)
          );

          const faviconPromise = webApi.get<{ image: string }>('Favicon/Extract?url=' + request.origin);
          const faviconResponse = await Promise.race([faviconPromise, timeoutPromise]) as { image: string };

          if (faviconResponse?.image) {
            // Use browser-compatible base64 decoding
            const binaryString = atob(faviconResponse.image);
            const decodedImage = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              decodedImage[i] = binaryString.charCodeAt(i);
            }
            faviconLogo = decodedImage;
          }
        } catch {
          // Favicon extraction failed or timed out, this is not a critical error so we can ignore it.
        }
      }

      // Build the CreateRequest
      const createRequest: CreateRequest = {
        origin: request.origin,
        requestId: request.requestId,
        publicKey: {
          rp: request.publicKey.rp,
          user: request.publicKey.user,
          challenge: request.publicKey.challenge,
          pubKeyCredParams: request.publicKey.pubKeyCredParams,
          attestation: request.publicKey.attestation,
          authenticatorSelection: request.publicKey.authenticatorSelection
        }
      };

      /**
       * Generate a new GUID for the passkey which will be embedded in the passkey
       * metadata and send back to the RP as the credential.id and credential.rawId.
       */
      const newPasskeyGuid = crypto.randomUUID().toUpperCase();
      const newPasskeyGuidBytes = PasskeyHelper.guidToBytes(newPasskeyGuid);
      const newPasskeyGuidBase64url = PasskeyHelper.guidToBase64url(newPasskeyGuid);

      // Check if PRF evaluation is requested during registration
      const prfExtension = request.publicKey?.extensions?.prf;
      const enablePrf = !!prfExtension;
      const prfEvalInputs = prfExtension?.eval;

      // Create passkey using static method (generates keys and credential ID)
      const result = await PasskeyAuthenticator.createPasskey(newPasskeyGuidBytes, createRequest, {
        uvPerformed: true,
        credentialIdBytes: 16,
        enablePrf,
        prfInputs: prfEvalInputs // Pass PRF evaluation salts if provided
      });

      const { credential, stored, prfEnabled, prfResults } = result;

      // Use vault mutation to store both credential and passkey
      await executeVaultMutation(
        async () => {
          if (selectedPasskeyToReplace) {
            // Replace existing passkey: update the credential and passkey
            const existingPasskey = dbContext.sqliteClient!.getPasskeyById(selectedPasskeyToReplace);
            if (existingPasskey) {
              // Update the parent credential with new favicon and user-provided display name
              await dbContext.sqliteClient!.updateCredentialById(
                {
                  Id: existingPasskey.CredentialId,
                  ServiceName: displayName,
                  ServiceUrl: request.origin,
                  Username: request.publicKey.user.name,
                  Password: '',
                  Notes: '',
                  Logo: faviconLogo ?? undefined,
                  Alias: {
                    FirstName: '',
                    LastName: '',
                    NickName: '',
                    BirthDate: '0001-01-01 00:00:00',
                    Gender: '',
                    Email: ''
                  },
                },
                [],
                []
              );

              // Delete the old passkey
              await dbContext.sqliteClient!.deletePasskeyById(selectedPasskeyToReplace);

              /**
               * Create new passkey with same credential
               * Convert userId from base64 string to byte array for database storage
               */
              let userHandleBytes: Uint8Array | null = null;
              if (stored.userId) {
                try {
                  userHandleBytes = PasskeyHelper.base64urlToBytes(stored.userId);
                } catch {
                  // If conversion fails, store as null
                  userHandleBytes = null;
                }
              }

              await dbContext.sqliteClient!.createPasskey({
                Id: newPasskeyGuid,
                CredentialId: existingPasskey.CredentialId,
                RpId: stored.rpId,
                UserHandle: userHandleBytes,
                PublicKey: JSON.stringify(stored.publicKey),
                PrivateKey: JSON.stringify(stored.privateKey),
                DisplayName: request.publicKey.user.displayName || request.publicKey.user.name || '',
                PrfKey: stored.prfSecret ? PasskeyHelper.base64urlToBytes(stored.prfSecret) : undefined,
                AdditionalData: null
              });
            }
          } else {
            // Create new credential and passkey
            const credentialId = await dbContext.sqliteClient!.createCredential(
              {
                Id: '',
                ServiceName: displayName,
                ServiceUrl: request.origin,
                Username: request.publicKey.user.name,
                Password: '',
                Notes: '',
                Logo: faviconLogo ?? undefined,
                Alias: {
                  FirstName: '',
                  LastName: '',
                  NickName: '',
                  BirthDate: '0001-01-01 00:00:00', // TODO: once birthdate is made nullable in datamodel refactor, remove this.
                  Gender: '',
                  Email: ''
                }
              },
              []
            );

            /**
             * Create the Passkey linked to the credential
             * Note: We let the database generate a GUID for Id, which we'll convert to base64url for the RP
             * Convert userId from base64 string to byte array for database storage
             */
            let userHandleBytes: Uint8Array | null = null;
            if (stored.userId) {
              try {
                userHandleBytes = PasskeyHelper.base64urlToBytes(stored.userId);
              } catch {
                // If conversion fails, store as null
                userHandleBytes = null;
              }
            }

            await dbContext.sqliteClient!.createPasskey({
              Id: newPasskeyGuid,
              CredentialId: credentialId,
              RpId: stored.rpId,
              UserHandle: userHandleBytes,
              PublicKey: JSON.stringify(stored.publicKey),
              PrivateKey: JSON.stringify(stored.privateKey),
              DisplayName: request.publicKey.user.displayName || request.publicKey.user.name || '',
              PrfKey: stored.prfSecret ? PasskeyHelper.base64urlToBytes(stored.prfSecret) : undefined,
              AdditionalData: null
            });
          }
        },
        {
          /**
           * Wait for vault mutation to have synced with server, then send passkey create success response
           * with the GUID-based credential ID.
           */
          onSuccess: async () => {
            // Prepare PRF extension response if PRF was enabled
            let prfExtensionResponse;
            if (prfEnabled) {
              prfExtensionResponse = {
                prf: {
                  enabled: true,
                  results: prfResults ? {
                    first: PasskeyHelper.bytesToBase64url(new Uint8Array(prfResults.first)),
                    second: prfResults.second ? PasskeyHelper.bytesToBase64url(new Uint8Array(prfResults.second)) : undefined
                  } : undefined
                }
              };
            }

            // Use the GUID-based credential ID instead of the random one from the provider
            const flattenedCredential: PasskeyCreateCredentialResponse = {
              id: newPasskeyGuidBase64url,
              rawId: newPasskeyGuidBase64url,
              clientDataJSON: credential.response.clientDataJSON,
              attestationObject: credential.response.attestationObject,
              extensions: prfExtensionResponse
            };

            /*
             * Send response back to background
             * The background script will close the window (Safari-compatible)
             */
            await sendMessage('PASSKEY_POPUP_RESPONSE', {
              requestId: request.requestId,
              credential: flattenedCredential
            }, 'background');
          },
          /**
           * onError
           */
          onError: (err) => {
            console.error('PasskeyCreate: Error storing passkey', err);
            setError(t('common.errors.unknownError'));
          }
        }
      );
    } catch (error) {
      console.error('PasskeyCreate: Error creating passkey', error);
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

    /*
     * Tell background to use native implementation
     * The background script will close the window (Safari-compatible)
     */
    await sendMessage('PASSKEY_POPUP_RESPONSE', {
      requestId: request.requestId,
      fallback: true
    }, 'background');
  };

  /**
   * Handle cancel
   */
  const handleCancel = async () : Promise<void> => {
    if (!request) {
      return;
    }

    /*
     * Tell background user cancelled
     * The background script will close the window (Safari-compatible)
     */
    await sendMessage('PASSKEY_POPUP_RESPONSE', {
      requestId: request.requestId,
      cancelled: true
    }, 'background');
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

      {(localLoading || isMutating) && (
        <div className="fixed inset-0 flex flex-col justify-center items-center bg-white dark:bg-gray-900 bg-opacity-90 dark:bg-opacity-90 z-50">
          <LoadingSpinner />
          <div className="text-sm text-gray-500 mt-2">
            {syncStatus}
          </div>
        </div>
      )}

      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            {t('passkeys.create.title')}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('passkeys.create.createFor')} <strong>{request.origin}</strong>
          </p>
        </div>

        {error && (
          <Alert variant="error">
            {error}
          </Alert>
        )}

        {/* Step 1: Show existing passkeys selection or create new option */}
        {!showCreateForm && existingPasskeys.length > 0 && (
          <div className="space-y-4">
            <Button
              variant="primary"
              onClick={handleCreateNew}
              ref={createNewButtonRef}
            >
              {t('passkeys.create.createNewPasskey')}
            </Button>

            <Button
              variant="secondary"
              onClick={handleFallback}
            >
              {t('passkeys.create.useBrowserPasskey')}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300 dark:border-gray-600" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  {t('common.or')}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('passkeys.create.selectPasskeyToReplace')}
              </label>
              <div className="space-y-2 max-h-48 overflow-y-auto border rounded-lg p-2 bg-gray-50 dark:bg-gray-800">
                {existingPasskeys.map((passkey) => (
                  <button
                    key={passkey.Id}
                    onClick={() => handleSelectReplace(passkey.Id)}
                    className="w-full p-3 text-left rounded-lg border cursor-pointer transition-colors bg-white border-gray-200 hover:bg-gray-100 hover:border-gray-300 dark:bg-gray-700 dark:border-gray-600 dark:hover:bg-gray-600 dark:hover:border-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                          {passkey.ServiceName}
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                          <span className="truncate">{passkey.DisplayName}</span>
                        </div>
                      </div>
                      <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <Button
              variant="secondary"
              onClick={handleCancel}
            >
              {t('common.cancel')}
            </Button>
          </div>
        )}

        {/* Step 2: Show create form with display name */}
        {showCreateForm && (
          <div className="space-y-4">
            {selectedPasskeyToReplace && (
              <Alert variant="warning">
                {t('passkeys.create.replacingPasskey', {
                  displayName: existingPasskeys.find(p => p.Id === selectedPasskeyToReplace)?.DisplayName || ''
                })}
              </Alert>
            )}

            <FormInput
              id="displayName"
              label={t('passkeys.create.titleLabel')}
              value={displayName}
              onChange={setDisplayName}
              placeholder={t('passkeys.create.titlePlaceholder')}
              ref={displayNameInputRef}
            />

            <div className="space-y-3">
              <Button
                variant="primary"
                onClick={handleCreate}
              >
                {selectedPasskeyToReplace ? t('passkeys.create.confirmReplace') : t('passkeys.create.createButton')}
              </Button>

              {existingPasskeys.length > 0 ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowCreateForm(false);
                    setSelectedPasskeyToReplace(null);
                  }}
                >
                  {t('common.back')}
                </Button>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    onClick={handleFallback}
                  >
                    {t('passkeys.create.useBrowserPasskey')}
                  </Button>

                  <Button
                    variant="secondary"
                    onClick={handleCancel}
                  >
                    {t('common.cancel')}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default PasskeyCreate;
