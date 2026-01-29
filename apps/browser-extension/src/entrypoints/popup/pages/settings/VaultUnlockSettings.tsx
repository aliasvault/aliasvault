import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessage from '@/entrypoints/popup/components/AlertMessage';
import Button from '@/entrypoints/popup/components/Button';
import HelpModal from '@/entrypoints/popup/components/Dialogs/HelpModal';
import { useDb } from '@/entrypoints/popup/context/DbContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import {
  isPinEnabled,
  setupPin,
  removeAndDisablePin,
  isValidPin,
  isPinLocked,
  InvalidPinFormatError
} from '@/utils/PinUnlockService';

import { storage } from '#imports';

/**
 * Vault unlock method settings page component.
 */
const VaultUnlockSettings: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const { setIsInitialLoading, showLoading, hideLoading } = useLoading();

  const [pinEnabled, setPinEnabled] = useState<boolean | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPinSetup, setShowPinSetup] = useState<boolean>(false);
  const [pinSetupStep, setPinSetupStep] = useState<number>(1); // 1 = enter, 2 = confirm
  const [newPin, setNewPin] = useState<string>('');
  const [confirmPin, setConfirmPin] = useState<string>('');
  const [isLocked, setIsLocked] = useState<boolean>(false);

  /**
   * Load PIN settings.
   */
  const loadSettings = useCallback(async (): Promise<void> => {
    try {
      const [enabled, locked] = await Promise.all([
        isPinEnabled(),
        isPinLocked()
      ]);

      setPinEnabled(enabled);
      setIsLocked(locked);
      setIsInitialLoading(false);
    } catch (err: unknown) {
      console.error('Failed to load PIN settings:', err);
      setError(t('common.errors.unknownErrorTryAgain'));
      setIsInitialLoading(false);
    }
  }, [setIsInitialLoading, t]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  /**
   * Handle enable PIN - show setup modal.
   */
  const handleEnablePin = (): void => {
    setError(null);
    setSuccess(null);

    // Check if we have the encryption key in memory
    if (!dbContext.dbAvailable) {
      setError(t('common.errors.unknownErrorTryAgain'));
      return;
    }

    setPinSetupStep(1);
    setNewPin('');
    setConfirmPin('');
    setShowPinSetup(true);
  };

  /**
   * Handle PIN setup submission (step 1: enter PIN).
   */
  const handlePinSetupNext = (e: React.FormEvent): void => {
    e.preventDefault();
    setError(null);

    // Validate PIN format
    if (!isValidPin(newPin)) {
      setError(t('settings.unlockMethod.invalidPinFormat'));
      return;
    }

    // Move to confirmation step
    setPinSetupStep(2);
  };

  /**
   * Handle PIN setup submission (step 2: confirm PIN).
   */
  const handlePinSetupSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Validate PIN confirmation
    if (newPin !== confirmPin) {
      setError(t('settings.unlockMethod.pinMismatch'));
      return;
    }

    try {
      showLoading();

      /* Get the encryption key from session storage */
      const encryptionKeyResponse = await storage.getItem('session:encryptionKey') as string | undefined;
      const encryptionKey = encryptionKeyResponse as string;

      if (!encryptionKey) {
        setError(t('common.errors.unknownErrorTryAgain'));
        hideLoading();
        return;
      }

      /* Setup PIN with the encryption key */
      await setupPin(newPin, encryptionKey);

      setPinEnabled(true);
      setShowPinSetup(false);
      setPinSetupStep(1);
      setNewPin('');
      setConfirmPin('');
      setSuccess(t('settings.unlockMethod.enableSuccess'));
      hideLoading();
    } catch (err: unknown) {
      console.error('Failed to enable PIN:', err);

      if (err instanceof InvalidPinFormatError) {
        setError(t('settings.unlockMethod.invalidPinFormat'));
      } else {
        setError(t('common.errors.unknownErrorTryAgain'));
      }

      hideLoading();
    }
  };

  /**
   * Handle disable PIN.
   */
  const handleDisablePin = async (): Promise<void> => {
    setError(null);
    setSuccess(null);

    try {
      showLoading();
      await removeAndDisablePin();
      setPinEnabled(false);
      setIsLocked(false);
      hideLoading();
    } catch (err: unknown) {
      console.error('Failed to disable PIN:', err);
      setError(t('common.errors.unknownErrorTryAgain'));
      hideLoading();
    }
  };

  return (
    <>
      <div className="flex items-start gap-2">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('settings.unlockMethod.introText')}
        </p>
      </div>
      <div className="mt-6">
        {/* Error/Success Messages */}
        {error && <AlertMessage type="error" message={error} className="mb-4" />}
        {success && <AlertMessage type="success" message={success} className="mb-4" />}

        {/* Locked Warning */}
        {isLocked && (
          <AlertMessage
            type="warning"
            message={t('settings.unlockMethod.pinLocked')}
            className="mb-4"
          />
        )}

        {/* PIN Code option */}
        <section>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <svg className="w-5 h-5 mr-2 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                  </svg>
                  <div>
                    <div className="flex items-center">
                      <p className="font-medium text-gray-900 dark:text-white">{t('settings.unlockMethod.pin')}</p>
                      <HelpModal
                        title={t('common.notice')}
                        content={t('settings.unlockMethod.pinSecurityWarning')}
                        className="ml-2"
                      />
                    </div>
                    <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">
                      {t('settings.unlockMethod.pinDescription')}
                    </p>
                  </div>
                </div>
                {pinEnabled !== undefined && (
                  <button
                    onClick={pinEnabled && !isLocked ? handleDisablePin : handleEnablePin}
                    className={`px-4 py-2 rounded-md transition-colors ${
                      pinEnabled && !isLocked
                        ? 'bg-green-500 hover:bg-green-600 text-white'
                        : 'bg-red-500 hover:bg-red-600 text-white'
                    }`}
                  >
                    {pinEnabled && !isLocked ? t('common.enabled') : t('common.disabled')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Master Password option (always enabled, cannot be toggled) */}
        <section className="mt-4">
          <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <svg className="w-5 h-5 mr-2 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{t('settings.unlockMethod.password')}</p>
                  </div>
                </div>
                <div className="px-4 py-2 rounded-md bg-green-500 text-white hover:bg-green-600 cursor-not-allowed">
                  {t('common.enabled')}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PIN Setup Modal */}
        {showPinSetup && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 relative">
              {/* Cancel button in top right corner */}
              <button
                type="button"
                onClick={() => {
                  setShowPinSetup(false);
                  setPinSetupStep(1);
                  setNewPin('');
                  setConfirmPin('');
                  setError(null);
                }}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
                aria-label="Cancel"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Step 1: Enter PIN */}
              {pinSetupStep === 1 && (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 pr-8">
                    {t('settings.unlockMethod.setupPin')}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    {t('settings.unlockMethod.enterNewPinDescription')}
                  </p>
                  <form onSubmit={handlePinSetupNext}>
                    <div className="mb-4">
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={8}
                        value={newPin}
                        onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-center text-2xl tracking-widest"
                        autoFocus
                      />
                    </div>
                    {error && <AlertMessage type="error" message={error} className="mb-4" />}
                    <Button type="submit">
                      {t('common.next')}
                    </Button>
                  </form>
                </>
              )}

              {/* Step 2: Confirm PIN */}
              {pinSetupStep === 2 && (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 pr-8">
                    {t('settings.unlockMethod.confirmPin')}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    {t('settings.unlockMethod.confirmPinDescription')}
                  </p>
                  <form onSubmit={handlePinSetupSubmit}>
                    <div className="mb-4">
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={8}
                        value={confirmPin}
                        onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-center text-2xl tracking-widest"
                        autoFocus
                      />
                    </div>
                    {error && <AlertMessage type="error" message={error} className="mb-4" />}
                    <Button type="submit">
                      {t('common.confirm')}
                    </Button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default VaultUnlockSettings;
