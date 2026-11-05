import { extractDomain } from '@aliasvault/client/rust/RustCore';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import Button from '@/entrypoints/popup/components/Button';
import PasskeyBypassDialog from '@/entrypoints/popup/components/Dialogs/PasskeyBypassDialog';
import LoadingSpinner from '@/entrypoints/popup/components/LoadingSpinner';
import UsernameAvatar from '@/entrypoints/popup/components/Unlock/UsernameAvatar';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import type { PendingPasskeyRequest } from '@/utils/passkey/types';

type PasskeyVaultLockedProps = {
  subtitle: string;
};

/**
 * Passkey popup view while the vault is locked or the user is logged out: unlock or log in, use the browser passkey, or cancel.
 */
const PasskeyVaultLocked: React.FC<PasskeyVaultLockedProps> = ({ subtitle }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { isLoggedIn } = useApp();
  const { setIsInitialLoading } = useLoading();
  const [request, setRequest] = useState<PendingPasskeyRequest | null>(null);
  const [showBypassDialog, setShowBypassDialog] = useState(false);

  useEffect(() => {
    /**
     * Load the pending request this popup was opened for.
     */
    const fetchRequestData = async (): Promise<void> => {
      const requestId = new URLSearchParams(location.search).get('requestId');
      if (requestId) {
        setRequest(await sendMessage('GET_REQUEST_DATA', { requestId }) as unknown as PendingPasskeyRequest | null);
      }
      setIsInitialLoading(false);
    };

    fetchRequestData();
  }, [location.search, setIsInitialLoading]);

  /**
   * Go to the unlock or login page and come back to this request afterwards.
   */
  const handleUnlock = async (): Promise<void> => {
    await LocalPreferencesService.setPendingRedirectUrl(`${location.pathname}${location.search}`);
    navigate(isLoggedIn ? '/unlock' : '/login');
  };

  /**
   * Hand the request to the browser's passkey provider, remembering the choice if asked.
   */
  const handleBypassChoice = async (choice: 'once' | 'always' | 'untilLogin'): Promise<void> => {
    if (!request) {
      return;
    }

    if (choice === 'always') {
      await LocalPreferencesService.addPasskeyDisabledSite(await extractDomain(request.origin));
    } else if (choice === 'untilLogin') {
      await sendMessage('DISMISS_PASSKEY_LOCKED_POPUP');
    }

    await sendMessage('PASSKEY_POPUP_RESPONSE', { requestId: request.requestId, fallback: true });
  };

  /**
   * Logged in: ask how long to use the browser passkey. Logged out: use it until the user logs in, like the autofill popup.
   */
  const handleUseBrowserPasskey = async (): Promise<void> => {
    if (isLoggedIn) {
      setShowBypassDialog(true);
      return;
    }

    await handleBypassChoice('untilLogin');
  };

  /**
   * Tell the page the user cancelled.
   */
  const handleCancel = async (): Promise<void> => {
    if (!request) {
      return;
    }

    await sendMessage('PASSKEY_POPUP_RESPONSE', { requestId: request.requestId, cancelled: true });
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
      <PasskeyBypassDialog
        isOpen={showBypassDialog}
        origin={new URL(request.origin).hostname}
        onChoice={handleBypassChoice}
        onCancel={() => setShowBypassDialog(false)}
      />

      <div className="flex flex-col items-center justify-center">
        <div className="w-full max-w-md">
          {isLoggedIn && <UsernameAvatar />}

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <div className="text-center mb-6">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                {isLoggedIn ? t('common.errors.vaultIsLocked') : t('auth.loginTitle')}
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 break-words">
                {subtitle} <strong className="break-all">{new URL(request.origin).hostname}</strong>
              </p>
            </div>

            <div className="flex flex-col w-full space-y-2">
              <Button onClick={handleUnlock}>
                {isLoggedIn ? t('auth.unlockVault') : t('auth.login')}
              </Button>
              <Button variant="secondary" onClick={handleUseBrowserPasskey}>
                {t('passkeys.useBrowserPasskey')}
              </Button>
              <Button variant="secondary" onClick={handleCancel}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default PasskeyVaultLocked;
