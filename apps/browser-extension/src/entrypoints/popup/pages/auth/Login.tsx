import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { sendMessage } from 'webext-bridge/popup';

import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';
import { useWallet } from '@/entrypoints/popup/context/WalletContext';
import { getExplorerAddressUrl } from '@/entrypoints/popup/config/explorerConfig';
import type { VaultLoadResponse } from '@/utils/types/messaging/VaultLoadResponse';

import { storage } from '#imports';

/**
 * Login page — wallet-based authentication only.
 * SRP (username/password) auth has been removed in favor of Midnight wallet signing.
 */
const Login: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const app = useApp();
  const { setHeaderButtons } = useHeaderButtons();
  const { setIsInitialLoading } = useLoading();
  const [error, setError] = useState<string | null>(null);
  const [isCheckingVault, setIsCheckingVault] = useState(false);
  const wallet = useWallet();

  useEffect(() => {
    setIsInitialLoading(false);
  }, [setIsInitialLoading]);

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    const headerButtonsJSX = !PopoutUtility.isPopup() ? (
      <>
        <HeaderButton
          onClick={() => PopoutUtility.openInNewPopup()}
          title="Open in new window"
          iconType={HeaderIconType.EXPAND}
        />
      </>
    ) : null;

    setHeaderButtons(headerButtonsJSX);

    return () => {
      setHeaderButtons(null);
    };
  }, [setHeaderButtons]);

  const { setAuthTokens } = app;

  /**
   * Task 1 (AC #6): Set auth tokens after wallet verification so Reinitialize
   * recognizes the user as logged in. Uses wallet address as placeholder token.
   */
  useEffect(() => {
    if (wallet.isVerified && wallet.walletState) {
      const addr = wallet.walletState.address;
      const placeholder = `wallet:${addr}`;
      setAuthTokens(addr, placeholder, placeholder);
    }
  }, [wallet.isVerified, wallet.walletState, setAuthTokens]);

  /**
   * Handle Lace wallet connection
   */
  const handleWalletConnect = async () : Promise<void> => {
    setError(null);
    await wallet.connectWallet();
  };

  /**
   * Task 2 (AC #1, #2): After verification, check if vault exists on-chain
   * to route new users to /create-password and returning users to /unlock.
   */
  const handleContinue = async (): Promise<void> => {
    setIsCheckingVault(true);
    setError(null);

    try {
      const loadResponse = await sendMessage('LOAD_VAULT_FROM_BLOCKCHAIN', {}, 'background') as VaultLoadResponse;

      if (!loadResponse.success) {
        setError(loadResponse.error ?? t('common.errors.unknownError'));
        return;
      }

      if (loadResponse.notRegistered) {
        navigate('/create-password', { replace: true });
      } else if (loadResponse.encryptedBlob) {
        await storage.setItem('session:encryptedVault', loadResponse.encryptedBlob);
        navigate('/unlock', { replace: true });
      } else if (loadResponse.upToDate) {
        navigate('/unlock', { replace: true });
      } else {
        setError(t('common.errors.unknownError'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errors.unknownError'));
    } finally {
      setIsCheckingVault(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          {/* Title */}
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t('auth.loginTitle')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('wallet.connectToAuthenticate')}
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 text-red-500 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Lace Wallet Connection + Signature Challenge */}
          {wallet.isConnected && wallet.walletState && wallet.isVerified ? (
            /* State 3: Wallet connected AND signature verified */
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                  </svg>
                  <span className="text-sm font-medium text-green-700 dark:text-green-400">
                    {t('wallet.verified')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => wallet.disconnectWallet()}
                  className="text-xs text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400"
                >
                  {t('wallet.disconnect')}
                </button>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300 font-mono break-all">
                {wallet.walletState.address.slice(0, 20)}...{wallet.walletState.address.slice(-12)}
              </p>
              {(() => {
                const explorerUrl = getExplorerAddressUrl(wallet.walletState.address);
                return explorerUrl ? (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                    </svg>
                    {t('wallet.verifyOnExplorer')}
                  </a>
                ) : null;
              })()}
              <button
                type="button"
                onClick={handleContinue}
                disabled={isCheckingVault}
                className="mt-3 w-full px-4 py-2.5 text-sm font-medium text-center text-white bg-primary-600 border border-primary-600 rounded-lg hover:bg-primary-700 focus:ring-4 focus:ring-primary-200 dark:bg-primary-700 dark:border-primary-700 dark:hover:bg-primary-600 dark:focus:ring-primary-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCheckingVault ? t('common.loading') : t('auth.continue')}
              </button>
            </div>
          ) : wallet.isConnected && wallet.walletState ? (
            /* State 2: Wallet connected, needs signature challenge */
            <div className="space-y-2">
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
                      {t('wallet.connected')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => wallet.disconnectWallet()}
                    className="text-xs text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400"
                  >
                    {t('wallet.disconnect')}
                  </button>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300 font-mono break-all">
                  {wallet.walletState.address.slice(0, 20)}...{wallet.walletState.address.slice(-12)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => wallet.signChallenge()}
                disabled={wallet.isSigning}
                className="w-full px-4 py-2.5 text-sm font-medium text-center text-white bg-green-600 border border-green-600 rounded-lg hover:bg-green-700 focus:ring-4 focus:ring-green-200 dark:bg-green-700 dark:border-green-700 dark:hover:bg-green-600 dark:focus:ring-green-800 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>
                </svg>
                {wallet.isSigning ? t('wallet.signing') : t('wallet.signChallenge')}
              </button>
            </div>
          ) : (
            /* State 1: Not connected */
            <button
              type="button"
              onClick={handleWalletConnect}
              disabled={wallet.isConnecting}
              className="w-full px-4 py-2.5 text-sm font-medium text-center text-white bg-purple-600 border border-purple-600 rounded-lg hover:bg-purple-700 focus:ring-4 focus:ring-purple-200 dark:bg-purple-700 dark:border-purple-700 dark:hover:bg-purple-600 dark:focus:ring-purple-800 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path>
              </svg>
              {wallet.isConnecting ? t('wallet.connecting') : t('wallet.connectLace')}
            </button>
          )}

          {/* Wallet Error */}
          {wallet.error && (
            <p className="mt-2 text-xs text-red-500 dark:text-red-400 text-center">
              {wallet.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
