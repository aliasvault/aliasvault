import { Buffer } from 'buffer';

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Button from '@/entrypoints/popup/components/Button';
import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import SrpUtility from '@/entrypoints/popup/utils/SrpUtility';

import { VAULT_LOCKED_DISMISS_UNTIL_KEY } from '@/utils/Constants';
import EncryptionUtility from '@/utils/EncryptionUtility';
import type { VaultResponse } from '@/utils/shared/models/webapi';

import { storage } from '#imports';

/**
 * Unlock page
 */
const Unlock: React.FC = () => {
  const authContext = useAuth();
  const dbContext = useDb();
  const navigate = useNavigate();

  const webApi = useWebApi();
  const srpUtil = new SrpUtility(webApi);

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { showLoading, hideLoading } = useLoading();

  useEffect(() => {
    /**
     * Make status call to API which acts as health check.
     */
    const checkStatus = async () : Promise<void> => {
      const statusResponse = await webApi.getStatus();
      const statusError = webApi.validateStatusResponse(statusResponse);
      if (statusError !== null) {
        await webApi.logout(statusError);
      }
    };

    checkStatus();
  }, [webApi, authContext]);

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
    <div className="max-w-md">
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-700 w-full shadow-md rounded px-8 pt-6 pb-8 mb-4">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white break-all overflow-hidden mb-4">{authContext.username}</h2>

        <p className="text-base text-gray-500 dark:text-gray-200 mb-6">
          Enter your master password to unlock your vault.
        </p>

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
