import { Buffer } from 'buffer';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { sendMessage } from 'webext-bridge/popup';

import Button from '@/entrypoints/popup/components/Button';
import { HeaderIcon, HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import EncryptionUtility from '@/utils/EncryptionUtility';
import { VaultStore } from '@/utils/dist/shared/vault-types';
import { VaultCidStore } from '@/services/VaultCidStore';

const MIN_PASSWORD_LENGTH = 8;

/**
 * CreatePassword page — new user master password creation and empty vault initialization.
 * Shown after wallet verification when no vault exists on-chain (AC #1, #3, #4, #5).
 */
const CreatePassword: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dbContext = useDb();
  const { showLoading, hideLoading, setIsInitialLoading } = useLoading();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsInitialLoading(false);
  }, [setIsInitialLoading]);

  const isValid = password.length >= MIN_PASSWORD_LENGTH && password === confirmPassword;

  const validationMessage = (): string | null => {
    if (password.length > 0 && password.length < MIN_PASSWORD_LENGTH) {
      return t('auth.passwordTooShort', { min: MIN_PASSWORD_LENGTH });
    }
    if (confirmPassword.length > 0 && password !== confirmPassword) {
      return t('auth.passwordsDoNotMatch');
    }
    return null;
  };

  /**
   * Task 4: Generate salt, derive key, create empty vault, encrypt, store, and initialize.
   */
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!isValid) return;

    setError(null);
    showLoading();

    try {
      // 4.1: Generate salt (32 random bytes → hex)
      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const hexSalt = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');

      // 4.2: Build derivation params
      const encryptionSettings = '{"Iterations":2,"MemorySize":19456,"DegreeOfParallelism":1}';
      const params = {
        encryptionType: 'Argon2Id',
        encryptionSettings,
        salt: hexSalt,
      };

      // 4.3: Derive encryption key
      const keyBytes = await EncryptionUtility.deriveKeyFromPassword(
        password, hexSalt, 'Argon2Id', encryptionSettings,
      );
      const keyBase64 = Buffer.from(keyBytes).toString('base64');

      // 4.4: Generate Midnight secretKey (32 random bytes → hex)
      const secretKeyBytes = crypto.getRandomValues(new Uint8Array(32));
      const secretKeyHex = Array.from(secretKeyBytes).map(b => b.toString(16).padStart(2, '0')).join('');

      // 4.5: Create empty vault with secretKey setting
      const vaultStore = VaultStore.createEmpty();
      vaultStore.setSetting('midnightSecretKey', secretKeyHex);
      const vaultJson = vaultStore.toJson();

      // 4.6: Encrypt vault
      const encryptedVault = await EncryptionUtility.symmetricEncrypt(vaultJson, keyBase64);

      // 4.7: Store in session via background messages (exact order)
      await sendMessage('STORE_ENCRYPTION_KEY_DERIVATION_PARAMS', params, 'background');
      await sendMessage('STORE_ENCRYPTION_KEY', keyBase64, 'background');
      await sendMessage('STORE_VAULT', {
        vaultBlob: encryptedVault,
        publicEmailDomainList: [],
        privateEmailDomainList: [],
        hiddenPrivateEmailDomainList: [],
        vaultRevisionNumber: 0,
      }, 'background');

      // 4.8: Cache secretKey locally
      await VaultCidStore.setSecretKey(secretKeyHex);

      // 4.9: Initialize DbContext
      await dbContext.initializeDatabaseFromBlob(encryptedVault, keyBase64);

      // Task 5: Navigate to /reinitialize
      navigate('/reinitialize', { replace: true });
    } catch (err) {
      console.error('Vault creation failed:', err);
      setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
    } finally {
      hideLoading();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              {t('auth.createMasterPassword')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('auth.createPasswordDescription')}
            </p>
          </div>

          {error && (
            <div className="mb-4 text-red-500 dark:text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          {/* Password input */}
          <div className="mb-4">
            <label className="block text-gray-700 dark:text-gray-200 font-medium mb-2" htmlFor="password">
              {t('auth.masterPassword')}
            </label>
            <div className="relative">
              <input
                className="shadow appearance-none border rounded-lg w-full py-2 px-3 pr-10 text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 leading-tight focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                autoFocus
              />
              <button
                type="button"
                className="absolute right-2 top-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                <HeaderIcon type={showPassword ? HeaderIconType.EYE_OFF : HeaderIconType.EYE} className="w-5 h-5 text-gray-400 dark:text-gray-500" />
              </button>
            </div>
          </div>

          {/* Confirm password input */}
          <div className="mb-4">
            <label className="block text-gray-700 dark:text-gray-200 font-medium mb-2" htmlFor="confirmPassword">
              {t('auth.confirmPassword')}
            </label>
            <input
              className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 leading-tight focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('auth.confirmPasswordPlaceholder')}
            />
          </div>

          {/* Validation message */}
          {(() => {
            const msg = validationMessage();
            return msg ? (
              <p className="mb-4 text-sm text-amber-600 dark:text-amber-400">
                {msg}
              </p>
            ) : null;
          })()}

          <Button type="submit" disabled={!isValid}>
            {t('auth.createVault')}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default CreatePassword;
