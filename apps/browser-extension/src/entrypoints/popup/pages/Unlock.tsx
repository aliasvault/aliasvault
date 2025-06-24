import { Buffer } from 'buffer';

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Button from '@/entrypoints/popup/components/Button';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';
import SrpUtility from '@/entrypoints/popup/utils/SrpUtility';

import { VAULT_LOCKED_DISMISS_UNTIL_KEY } from '@/utils/Constants';
import type { VaultResponse } from '@/utils/dist/shared/models/webapi';
import EncryptionUtility from '@/utils/EncryptionUtility';

import { storage } from '#imports';

/**
 * Unlock page
 */
const Unlock: React.FC = () => {
  const authContext = useAuth();
  const dbContext = useDb();
  const navigate = useNavigate();
  const { setHeaderButtons } = useHeaderButtons();

  const webApi = useWebApi();
  const srpUtil = new SrpUtility(webApi);

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { showLoading, hideLoading, setIsInitialLoading } = useLoading();

  useEffect(() => {
    /**
     * Make status call to API which acts as health check.
     */
    const checkStatus = async () : Promise<void> => {
      const statusResponse = await webApi.getStatus();
      const statusError = webApi.validateStatusResponse(statusResponse);
      if (statusError !== null) {
        await webApi.logout(statusError);
        navigate('/logout');
      }
      setIsInitialLoading(false);
    };

    checkStatus();
  }, [webApi, authContext, setIsInitialLoading, navigate]);

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    const headerButtonsJSX = !PopoutUtility.isPopup() ? (
      <HeaderButton
        onClick={() => PopoutUtility.openInNewPopup()}
        title="Open in new window"
        iconType={HeaderIconType.EXPAND}
      />
    ) : null;

    setHeaderButtons(headerButtonsJSX);

    return () => {
      setHeaderButtons(null);
    };
  }, [setHeaderButtons]);

  /**
   * Handle submit
   */
  const handleSubmit = async (e: React.FormEvent) : Promise<void> => {
    e.preventDefault();
    setError(null);
    showLoading();

    try {
      // 1. Initiate login to get salt and server ephemeral
      const loginResponse = await srpUtil.initiateLogin(authContext.username!);

      // Derive key from password using user's encryption settings
      const passwordHash = await EncryptionUtility.deriveKeyFromPassword(
        password,
        loginResponse.salt,
        loginResponse.encryptionType,
        loginResponse.encryptionSettings
      );

      // Make API call to get latest vault
      const vaultResponseJson = await webApi.get<VaultResponse>('Vault');

      const vaultError = webApi.validateVaultResponse(vaultResponseJson);
      if (vaultError) {
        setError(vaultError);
        hideLoading();
        return;
      }

      // Get the derived key as base64 string required for decryption.
      const passwordHashBase64 = Buffer.from(passwordHash).toString('base64');

      // Initialize the SQLite context with the new vault data.
      await dbContext.initializeDatabase(vaultResponseJson, passwordHashBase64);

      // Clear dismiss until (which can be enabled after user has dimissed vault is locked popup) to ensure popup is shown.
      await storage.setItem(VAULT_LOCKED_DISMISS_UNTIL_KEY, 0);

      // Redirect to reinitialize page
      navigate('/reinitialize', { replace: true });
    } catch (err) {
      setError('Failed to unlock vault. Please check your password and try again.');
      console.error('Unlock error:', err);
    } finally {
      hideLoading();
    }
  };

  /**
   * Handle logout
   */
  const handleLogout = () : void => {
    navigate('/logout', { replace: true });
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-700 w-full shadow-md rounded px-8 pt-6 pb-8 mb-4">
        {/* User Avatar and Username Section */}
        <div className="flex items-center space-x-3 mb-6">
          <div className="flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
              <span className="text-primary-600 dark:text-primary-400 text-lg font-medium">
                {authContext.username?.[0]?.toUpperCase() || '?'}
              </span>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {authContext.username}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Logged in
            </p>
          </div>
        </div>

        {/* Instruction Title */}
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          Unlock your vault
        </h2>

        {error && (
          <div className="mb-4 text-red-500 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="mb-6">
          <label className="block text-gray-700 dark:text-gray-200 text-sm font-bold mb-2" htmlFor="password">
            Password
          </label>
          <input
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 dark:text-gray-200 dark:bg-gray-800 dark:border-gray-600 mb-3 leading-tight focus:outline-none focus:shadow-outline"
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
          />
        </div>

        <Button type="submit">
          Unlock
        </Button>

        <div className="text-sm font-medium text-gray-500 dark:text-gray-200 mt-6">
          Switch accounts? <button onClick={handleLogout} className="text-primary-700 hover:underline dark:text-primary-500">Log out</button>
        </div>
      </form>
    </div>
  );
};

export default Unlock;
