import QRCode from 'qrcode';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';
import { MobileLoginErrorCode } from '@/entrypoints/popup/types/MobileLoginErrorCode';
import { MobileLoginUtility } from '@/entrypoints/popup/utils/MobileLoginUtility';

import type { MobileLoginResult } from '@/utils/types/messaging/MobileLoginResult';
import type { WebApiService } from '@/utils/WebApiService';

interface IMobileUnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: MobileLoginResult) => Promise<void>;
  webApi: WebApiService;
  mode?: 'login' | 'unlock';
}

/**
 * Modal component for mobile login/unlock via QR code scanning.
 */
const MobileUnlockModal: React.FC<IMobileUnlockModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  webApi,
  mode = 'login'
}) => {
  const { t } = useTranslation();
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [error, setError] = useState<MobileLoginErrorCode | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(120); // 2 minutes in seconds
  const mobileLoginRef = useRef<MobileLoginUtility | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Get translated error message for error code.
   */
  const getErrorMessage = (errorCode: MobileLoginErrorCode): string => {
    switch (errorCode) {
      case MobileLoginErrorCode.TIMEOUT:
        return t('common.errors.mobileLoginRequestExpired');
      case MobileLoginErrorCode.GENERIC:
      default:
        return t('common.errors.unknownError');
    }
  };

  // Countdown timer effect
  useEffect(() => {
    if (qrCodeUrl && timeRemaining > 0 && isOpen) {
      countdownIntervalRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current);
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return (): void => {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
      };
    }
  }, [qrCodeUrl, timeRemaining, isOpen]);

  // Initialize mobile login when modal opens
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    /**
     * Initialize mobile login on modal open.
     */
    const initiateMobileLogin = async (): Promise<void> => {
      try {
        setError(null);
        setQrCodeUrl(null);
        setTimeRemaining(120);

        // Initialize mobile login utility
        if (!mobileLoginRef.current) {
          mobileLoginRef.current = new MobileLoginUtility(webApi);
        }

        // Initiate mobile login and get QR code data
        const { requestId, publicKeyHash } = await mobileLoginRef.current.initiate();

        /*
         * Generate QR code with AliasVault prefix for mobile login.
         * Include public key hash as query parameter for security verification.
         */
        const qrData = `aliasvault://open/mobile-unlock/${requestId}?pk=${publicKeyHash}`;
        const qrDataUrl = await QRCode.toDataURL(qrData, {
          width: 256,
          margin: 2,
        });

        setQrCodeUrl(qrDataUrl);

        // Start polling for response
        await mobileLoginRef.current.startPolling(
          async (result: MobileLoginResult) => {
            try {
              // Call success callback (parent handles loading state)
              await onSuccess(result);
              // Close modal after successful processing
              handleClose();
            } catch {
              // Show error if success handler fails and hide QR code
              setQrCodeUrl(null);
              setError(MobileLoginErrorCode.GENERIC);
            }
          },
          (errorCode) => {
            // Hide QR code when error occurs
            setQrCodeUrl(null);
            setError(errorCode);
          }
        );
      } catch (err) {
        // err is a MobileLoginErrorCode thrown by initiate()
        if (typeof err === 'string' && Object.values(MobileLoginErrorCode).includes(err as MobileLoginErrorCode)) {
          setError(err as MobileLoginErrorCode);
        } else {
          setError(MobileLoginErrorCode.GENERIC);
        }
      }
    };

    initiateMobileLogin();

    // Cleanup on unmount or when modal closes
    return (): void => {
      if (mobileLoginRef.current) {
        mobileLoginRef.current.cleanup();
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /**
   * Handle modal close.
   */
  const handleClose = (): void => {
    if (mobileLoginRef.current) {
      mobileLoginRef.current.cleanup();
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }
    setQrCodeUrl(null);
    setError(null);
    setTimeRemaining(120);
    onClose();
  };

  /**
   * Format time remaining as MM:SS.
   */
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const title = mode === 'unlock' ? t('auth.unlockWithMobile') : t('auth.loginWithMobile');
  const description = t('auth.scanQrCode');

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      showHeaderBorder={false}
      bodyClassName="px-6 pb-6"
    >
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {description}
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-400 text-sm">
          {getErrorMessage(error)}
        </div>
      )}

      {qrCodeUrl && (
        <div className="flex flex-col items-center mb-4">
          <img src={qrCodeUrl} alt="QR Code" className="border-4 border-gray-200 dark:border-gray-600 rounded mb-3" />
          <div className="text-gray-700 dark:text-gray-300 text-sm font-medium">
            {formatTime(timeRemaining)}
          </div>
        </div>
      )}

      {!qrCodeUrl && !error && (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      )}

      <button
        type="button"
        onClick={handleClose}
        className="mt-4 w-full inline-flex justify-center rounded-md bg-white dark:bg-gray-700 px-3 py-2 text-sm font-semibold text-gray-900 dark:text-gray-200 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        {t('common.cancel')}
      </button>
    </ModalWrapper>
  );
};

export default MobileUnlockModal;
