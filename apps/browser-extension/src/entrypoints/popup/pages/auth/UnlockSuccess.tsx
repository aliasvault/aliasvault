import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { CountdownBar, ICountdownBarHandle } from '@/entrypoints/popup/components/CountdownBar';

import { LocalPreferencesService } from '@/utils/LocalPreferencesService';

const AUTO_CLOSE_COUNTDOWN_SECONDS = 2.5;

/**
 * Unlock success component shown when the vault is successfully unlocked in a separate popup
 * asking the user if they want to close the popup.
 */
const UnlockSuccess: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [autoCloseEnabled, setAutoCloseEnabled] = useState<boolean>(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownBarRef = useRef<ICountdownBarHandle>(null);

  /**
   * Clear the countdown timer
   */
  const clearCountdownTimer = useCallback((): void => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  /**
   * Start the auto-close countdown
   */
  const startCountdown = useCallback((): void => {
    clearCountdownTimer();
    setCountdown(AUTO_CLOSE_COUNTDOWN_SECONDS);

    // Start the animation bar
    countdownBarRef.current?.startAnimation(AUTO_CLOSE_COUNTDOWN_SECONDS);

    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearCountdownTimer();
          window.close();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearCountdownTimer]);

  /**
   * Stop the auto-close countdown
   */
  const stopCountdown = useCallback((): void => {
    clearCountdownTimer();
    setCountdown(null);
    countdownBarRef.current?.stopAnimation();
  }, [clearCountdownTimer]);

  /**
   * Handle checkbox change
   */
  const handleAutoCloseChange = async (checked: boolean): Promise<void> => {
    setAutoCloseEnabled(checked);
    await LocalPreferencesService.setAutoCloseUnlockPopup(checked);

    if (checked) {
      startCountdown();
    } else {
      stopCountdown();
    }
  };

  /**
   * Handle browsing vault contents - navigate to items page and reset mode parameter
   */
  const handleBrowseVaultContents = (): void => {
    stopCountdown();

    // Remove mode=inline from URL before navigating
    const url = new URL(window.location.href);
    url.searchParams.delete('mode');
    window.history.replaceState({}, '', url);

    // Navigate to items page
    navigate('/items');
  };

  /**
   * Handle close popup button click
   */
  const handleClosePopup = (): void => {
    stopCountdown();
    window.close();
  };

  // Load saved preference and start countdown if enabled
  useEffect(() => {
    /**
     * Load the auto-close preference from storage
     */
    const loadPreference = async (): Promise<void> => {
      const enabled = await LocalPreferencesService.getAutoCloseUnlockPopup();
      setAutoCloseEnabled(enabled);
      setIsLoading(false);

      if (enabled) {
        // Use setTimeout to ensure the CountdownBar component has mounted
        setTimeout(() => {
          startCountdown();
        }, 0);
      }
    };

    loadPreference();

    return (): void => {
      clearCountdownTimer();
    };
  }, [clearCountdownTimer, startCountdown]);

  return (
    <div className="flex flex-col items-center justify-center p-6 text-center">
      {/* Countdown bar at the top */}
      <CountdownBar
        ref={countdownBarRef}
        isVisible={countdown !== null}
        colorClass="bg-primary-500"
      />

      <div className="mb-4 text-green-600 dark:text-green-400">
        <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
        {t('auth.unlockSuccessTitle')}
      </h2>
      <p className="mb-6 text-gray-600 dark:text-gray-400">
        {t('auth.unlockSuccessDescription')}
      </p>

      <div className="space-y-3 w-full">
        <button
          onClick={handleClosePopup}
          className="w-full px-4 py-2 text-white bg-primary-600 rounded hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          {t('auth.closePopup')}
        </button>
        <button
          onClick={handleBrowseVaultContents}
          className="w-full px-4 py-2 text-gray-900 bg-white border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:border-gray-600"
        >
          {t('auth.browseVault')}
        </button>
      </div>

      {/* Auto-close checkbox at the bottom with subtle styling */}
      <div className="w-full mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
        <label className="flex items-center justify-center gap-2 cursor-pointer text-xs text-gray-400 dark:text-gray-500">
          <input
            type="checkbox"
            checked={autoCloseEnabled}
            onChange={(e) => handleAutoCloseChange(e.target.checked)}
            disabled={isLoading}
            className="w-3.5 h-3.5 rounded border-gray-300 text-gray-400 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700"
          />
          <span>{t('auth.autoCloseUnlockPopup')}</span>
        </label>
      </div>
    </div>
  );
};

export default UnlockSuccess;
