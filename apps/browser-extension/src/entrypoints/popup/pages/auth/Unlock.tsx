import { Buffer } from 'buffer';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import AlertMessage from '@/entrypoints/popup/components/AlertMessage';
import Button from '@/entrypoints/popup/components/Button';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIcon, HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import UsernameAvatar from '@/entrypoints/popup/components/Unlock/UsernameAvatar';
import { useApp } from '@/entrypoints/popup/context/AppContext';
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
import {
  getPinLength,
  isPinEnabled,
  PinLockedError,
  IncorrectPinError,
  InvalidPinFormatError,
  PinNotConfiguredError,
  resetFailedAttempts,
  unlockWithPin
} from '@/utils/PinUnlockService';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionIncompatibleError';

import { storage } from '#imports';

/**
 * Unlock mode type
 */
type UnlockMode = 'pin' | 'password';

/**
 * Unified unlock page that handles both PIN and password unlock
 */
const Unlock: React.FC = () => {
  const { t } = useTranslation();
  const app = useApp();
  const authContext = useAuth();
  const dbContext = useDb();
  const navigate = useNavigate();
  const { setHeaderButtons } = useHeaderButtons();

  const webApi = useWebApi();
  const srpUtil = new SrpUtility(webApi);

  // Unlock mode state
  const [unlockMode, setUnlockMode] = useState<UnlockMode>('password');
  const [pinAvailable, setPinAvailable] = useState<boolean>(false);

  // Password unlock state
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // PIN unlock state
  const [pin, setPin] = useState('');
  const [pinLength, setPinLength] = useState<number>(6);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Common state
  const [error, setError] = useState<string | null>(null);
  const { showLoading, hideLoading, setIsInitialLoading } = useLoading();

  /**
   * Make status call to API which acts as health check.
   * This runs only once during component mount.
   */
  const checkStatus = async () : Promise<boolean> => {
    const statusResponse = await webApi.getStatus();
    const statusError = webApi.validateStatusResponse(statusResponse);

    if (statusResponse.serverVersion === '0.0.0') {
      setError(t('common.errors.serverNotAvailable'));
      return false;
    }

    if (statusError !== null) {
      await app.logout(t('common.errors.' + statusError));
      return false;
    }

    setIsInitialLoading(false);
    return true;
  };

  /**
   * Initialize unlock page - check status and PIN availability
   */
  useEffect(() => {
    /**
     * Initialize unlock page - check status and PIN availability
     */
    const initialize = async (): Promise<void> => {
      // First check PIN availability and set initial mode
      const [pinEnabled, pinLength] = await Promise.all([
        isPinEnabled(),
        getPinLength(),
      ]);

      setPinAvailable(pinEnabled);
      setPinLength(pinLength || 6);

      // Default to PIN mode if available, otherwise password
      if (pinEnabled) {
        setUnlockMode('pin');
      } else {
        setUnlockMode('password');
      }

      // Then check API status
      await checkStatus();
    };

    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    const headerButtonsJSX = !PopoutUtility.isPopup() ? (
      <HeaderButton
        onClick={() => PopoutUtility.openInNewPopup()}
        title={t('common.openInNewWindow')}
        iconType={HeaderIconType.EXPAND}
      />
    ) : null;

    setHeaderButtons(headerButtonsJSX);

    return () => {
      setHeaderButtons(null);
    };
  }, [setHeaderButtons, t]);

  /**
   * Keep input focused for PIN mode
   */
  useEffect(() => {
    if (unlockMode !== 'pin') {
      return;
    }

    /**
     * Focus the hidden input element
     */
    const focusInput = (): void => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    };

    /**
     * Re-focus input whenever user clicks anywhere on the page
     */
    const handleClick = (): void => {
      focusInput();
    };

    /**
     * Re-focus input when window/extension regains focus
     */
    const handleFocus = (): void => {
      focusInput();
    };

    focusInput();

    const container = containerRef.current;
    if (container) {
      container.addEventListener('click', handleClick);
    }
    window.addEventListener('focus', handleFocus);

    return (): void => {
      if (container) {
        container.removeEventListener('click', handleClick);
      }
      window.removeEventListener('focus', handleFocus);
    };
  }, [unlockMode]);

  /**
   * Handle password unlock
   */
  const handlePasswordSubmit = async (e: React.FormEvent) : Promise<void> => {
    e.preventDefault();
    setError(null);
    showLoading();

    const isStatusOk = await checkStatus();
    if (!isStatusOk) {
      hideLoading();
      return;
    }

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

      // Get the derived key as base64 string required for decryption.
      const passwordHashBase64 = Buffer.from(passwordHash).toString('base64');

      // Store the encryption key in session storage.
      await dbContext.storeEncryptionKey(passwordHashBase64);

      // Initialize the SQLite context with the new vault data.
      const sqliteClient = await dbContext.initializeDatabase(vaultResponseJson, passwordHashBase64);

      // Check if there are pending migrations
      if (await sqliteClient.hasPendingMigrations()) {
        navigate('/upgrade', { replace: true });
        hideLoading();
        return;
      }

      // Clear dismiss until
      await storage.setItem(VAULT_LOCKED_DISMISS_UNTIL_KEY, 0);

      // Reset PIN failed attempts on successful password unlock
      await resetFailedAttempts();

      navigate('/reinitialize', { replace: true });
    } catch (err) {
      // Check if it's a version incompatibility error
      if (err instanceof VaultVersionIncompatibleError) {
        await app.logout(err.message);
      } else {
        setError(t('auth.errors.wrongPassword'));
      }
      console.error('Unlock error:', err);
    } finally {
      hideLoading();
    }
  };

  /**
   * Handle PIN input change
   */
  const handlePinChange = useCallback(async (newPin: string): Promise<void> => {
    setPin(newPin);
    setError(null);

    // Auto-submit when PIN length is reached
    if (newPin.length === pinLength) {
      // Small delay to allow UI to update with the last digit before showing loading spinner
      await new Promise(resolve => setTimeout(resolve, 50));
      await handlePinUnlock(newPin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinLength]);

  /**
   * Handle numpad button click
   */
  const handleNumpadClick = (digit: string): void => {
    if (pin.length < 8) {
      handlePinChange(pin + digit);
    }
  };

  /**
   * Handle backspace
   */
  const handleBackspace = (): void => {
    setPin(pin.slice(0, -1));
    setError(null);
  };

  /**
   * Handle PIN unlock
   */
  const handlePinUnlock = async (pinToUse: string = pin): Promise<void> => {
    if (pinToUse.length !== pinLength) {
      return;
    }

    setError(null);
    showLoading();

    try {
      // Unlock with PIN
      const passwordHashBase64 = await unlockWithPin(pinToUse);

      // Get latest vault from API
      const vaultResponseJson = await webApi.get<VaultResponse>('Vault');

      // Store the encryption key in session storage
      await dbContext.storeEncryptionKey(passwordHashBase64);

      // Initialize the SQLite context with the vault data
      const sqliteClient = await dbContext.initializeDatabase(vaultResponseJson, passwordHashBase64);

      // Check if there are pending migrations
      if (await sqliteClient.hasPendingMigrations()) {
        navigate('/upgrade', { replace: true });
        hideLoading();
        return;
      }

      // Clear dismiss until
      await storage.setItem(VAULT_LOCKED_DISMISS_UNTIL_KEY, 0);

      navigate('/reinitialize', { replace: true });
      hideLoading();
    } catch (err: unknown) {
      if (err instanceof PinLockedError) {
        setPinAvailable(false);
        setUnlockMode('password');
        setError(t('settings.unlockMethod.pinLocked'));
      } else if (err instanceof IncorrectPinError) {
        /* Show translatable error with attempts remaining */
        const attemptsRemaining = err.attemptsRemaining;
        if (attemptsRemaining === 1) {
          setError(t('settings.unlockMethod.incorrectPinSingular'));
        } else {
          setError(t('settings.unlockMethod.incorrectPin', { attemptsRemaining }));
        }
        setPin('');
      } else if (err instanceof InvalidPinFormatError) {
        setError(t('settings.unlockMethod.invalidPinFormat'));
        setPin('');
      } else if (err instanceof PinNotConfiguredError) {
        setError(t('settings.unlockMethod.pinNotConfigured'));
        setPin('');
      } else {
        console.error('PIN unlock failed:', err);
        setError(t('common.errors.unknownErrorTryAgain'));
        setPin('');
      }
      hideLoading();
    }
  };

  /**
   * Handle logout
   */
  const handleLogout = () : void => {
    app.logout();
  };

  /**
   * Switch to password mode
   */
  const switchToPassword = () : void => {
    setUnlockMode('password');
    setError(null);
  };

  /**
   * Switch to PIN mode
   */
  const switchToPin = () : void => {
    setUnlockMode('pin');
    setError(null);
  };

  // Generate PIN dots display
  const pinDots = Array.from({ length: pinLength }, (_, i) => (
    <div
      key={i}
      className={`w-4 h-4 rounded-full border-2 transition-all ${
        i < pin.length
          ? 'bg-primary-500 border-primary-500'
          : 'bg-transparent border-gray-300 dark:border-gray-600'
      }`}
    />
  ));

  // Render PIN unlock UI
  if (unlockMode === 'pin') {
    return (
      <div ref={containerRef} className="flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* User Avatar and Username Section */}
          <UsernameAvatar />

          {/* Main Content Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            {/* Title */}
            <div className="text-center mb-4">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                {t('auth.unlockTitle')}
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t('auth.enterPinToUnlock')}
              </p>
            </div>

            {/* PIN Dots Display */}
            <div className="flex justify-center gap-2 mb-4">
              {pinDots}
            </div>

            {/* Error Message */}
            {error && <AlertMessage type="error" message={error} className="mb-3 text-center" />}

            {/* Hidden Input for Keyboard Entry */}
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              value={pin}
              onChange={(e) => handlePinChange(e.target.value.replace(/\D/g, ''))}
              className="w-0 h-0 opacity-0 absolute"
              autoFocus
              aria-label="PIN input"
            />

            {/* On-Screen Numpad */}
            <div>
              <div className="grid grid-cols-3 gap-2">
                {/* Numbers 1-9 */}
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => handleNumpadClick(num.toString())}
                    className="h-12 flex items-center justify-center text-xl font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-lg transition-colors active:scale-95"
                  >
                    {num}
                  </button>
                ))}

                {/* Empty space, 0, Backspace */}
                <div />
                <button
                  type="button"
                  onClick={() => handleNumpadClick('0')}
                  className="h-12 flex items-center justify-center text-xl font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-lg transition-colors active:scale-95"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handleBackspace}
                  className="h-12 flex items-center justify-center bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-lg transition-colors active:scale-95"
                  aria-label="Backspace"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Use Password Button */}
          <div className="mt-4">
            <div className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
              <button type="button" onClick={switchToPassword} className="text-primary-600 hover:text-primary-700 dark:text-primary-500 dark:hover:text-primary-400 hover:underline font-medium">{t('auth.useMasterPassword')}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render password unlock UI
  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* User Avatar and Username Section */}
        <UsernameAvatar />

        {/* Main Content Card */}
        <form onSubmit={handlePasswordSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          {/* Title */}
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
              {t('auth.unlockTitle')}
            </h1>
          </div>

          {/* Error Message */}
          {error && <AlertMessage type="error" message={error} className="mb-4 text-center" />}

          <div className="mb-4">
            <label className="block text-gray-700 dark:text-gray-200 font-medium mb-2" htmlFor="password">
              {t('auth.masterPassword')}
            </label>
            <div className="relative">
              <input
                className="shadow appearance-none border rounded-lg w-full py-2 px-3 pr-10 text-gray-700 dark:text-gray-200 dark:bg-gray-700 dark:border-gray-600 leading-tight focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                required
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

          <Button type="submit">
            {t('auth.unlockVault')}
          </Button>

          <div className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
            {t('auth.switchAccounts')} <button type="button" onClick={handleLogout} className="text-primary-600 hover:text-primary-700 dark:text-primary-500 dark:hover:text-primary-400 hover:underline font-medium">{t('auth.logout')}</button>
          </div>
        </form>
      </div>

      {pinAvailable && (
        <div className="text-center text-sm text-gray-500 dark:text-gray-400 mt-6">
          <button type="button" onClick={switchToPin} className="text-primary-600 hover:text-primary-700 dark:text-primary-500 dark:hover:text-primary-400 hover:underline font-medium">{t('auth.unlockWithPin')}</button>
        </div>
      )}
    </div>
  );
};

export default Unlock;
