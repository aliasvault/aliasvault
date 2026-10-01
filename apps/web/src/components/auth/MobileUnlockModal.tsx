import { isMobileLoginErrorCode, MOBILE_LOGIN_REQUEST_LIFETIME_SECONDS, MobileLoginErrorCode, MobileLoginService } from '@aliasvault/client/auth/MobileLoginService';
import QRCode from 'qrcode';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AlertMessageError from '@/components/alerts/AlertMessageError';
import FormModal from '@/components/shared/FormModal';
import { useWebApi } from '@/context/WebApiContext';

import type { MobileLoginResult } from '@aliasvault/client/auth/MobileLoginService';

type MobileUnlockModalProps = {
  isOpen: boolean;
  mode: 'login' | 'unlock';
  onClose: () => void;
  onSuccess: (result: MobileLoginResult) => Promise<void>;
};

/**
 * Log in or unlock by scanning a QR code with the mobile app.
 */
const MobileUnlockModal: React.FC<MobileUnlockModalProps> = ({ isOpen, mode, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const webApi = useWebApi();
  
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [error, setError] = useState<MobileLoginErrorCode | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(MOBILE_LOGIN_REQUEST_LIFETIME_SECONDS);
  const onSuccessRef = useRef(onSuccess);
  const onCloseRef = useRef(onClose);
  onSuccessRef.current = onSuccess;
  onCloseRef.current = onClose;

  // Create a request each time the modal opens, and drop it when the modal closes.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const service = new MobileLoginService(webApi);
    let cancelled = false;
    setError(null);
    setQrCodeUrl(null);
    setVerificationCode(null);
    setTimeRemaining(MOBILE_LOGIN_REQUEST_LIFETIME_SECONDS);

    /**
     * Show the QR code and wait for the mobile app to answer.
     */
    const start = async (): Promise<void> => {
      try {
        const { qrPayload, verificationCode: code } = await service.initiate();
        const dataUrl = await QRCode.toDataURL(qrPayload, { width: 400, margin: 2 });
        if (cancelled) {
          service.cleanup();
          return;
        }
        setQrCodeUrl(dataUrl);
        setVerificationCode(code);

        service.startPolling(
          async (result) => {
            if (cancelled) {
              return;
            }
            try {
              await onSuccessRef.current(result);
              onCloseRef.current();
            } catch {
              setQrCodeUrl(null);
              setError(MobileLoginErrorCode.GENERIC);
            }
          },
          (errorCode) => {
            if (cancelled) {
              return;
            }
            setQrCodeUrl(null);
            setError(errorCode);
          }
        );
      } catch (err) {
        if (!cancelled) {
          setError(isMobileLoginErrorCode(err) ? err : MobileLoginErrorCode.GENERIC);
        }
      }
    };
    void start();

    return (): void => {
      cancelled = true;
      service.cleanup();
    };
  }, [isOpen, webApi]);

  // Count down while the QR code is shown.
  useEffect(() => {
    if (!qrCodeUrl) {
      return;
    }
    const interval = setInterval(() => setTimeRemaining(prev => Math.max(prev - 1, 0)), 1000);
    return (): void => clearInterval(interval);
  }, [qrCodeUrl]);

  /**
   * Translated message for an error code.
   */
  const getErrorMessage = (errorCode: MobileLoginErrorCode): string => {
    switch (errorCode) {
      case MobileLoginErrorCode.TIMEOUT:
        return t('common.errors.mobileLoginRequestExpired');
      case MobileLoginErrorCode.DECLINED:
        return t('common.errors.mobileLoginRequestDeclined');
      default:
        return t('common.errors.unknownErrorTryAgain');
    }
  };

  /**
   * Format seconds as M:SS.
   */
  const formatTime = (seconds: number): string => `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;

  return (
    <FormModal
      isOpen={isOpen}
      title={mode === 'unlock' ? t('auth.unlockWithMobile') : t('auth.loginWithMobile')}
      maxWidth="sm"
      submitOnEnter={false}
      onClose={onClose}
      footerContent={(
        <button type="button" onClick={onClose} className="inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-white dark:ring-gray-600 dark:hover:bg-gray-600">
          {t('common.cancel')}
        </button>
      )}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('auth.mobileUnlock.scanQrCodeDescription')}</p>
        {qrCodeUrl && (
          <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-xs font-medium tabular-nums text-gray-600 dark:text-gray-300">
            {formatTime(timeRemaining)}
          </span>
        )}
      </div>

      {error && <AlertMessageError message={getErrorMessage(error)} hasTopMargin={false} />}

      {qrCodeUrl && (
        <div className="flex flex-col items-center w-full">
          <img src={qrCodeUrl} alt={t('common.qrCode')} className="w-full bg-white rounded-lg border-4 border-gray-200 dark:border-gray-600 mb-3" />
          {verificationCode && (
            <div className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
              <div className="flex-shrink-0 flex items-center justify-center w-14 h-14 rounded-full border-2 border-primary-500 bg-white dark:bg-gray-800 text-2xl font-bold text-gray-900 dark:text-white">
                {verificationCode}
              </div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('auth.mobileUnlockVerificationCode')}</p>
            </div>
          )}
        </div>
      )}

      {!qrCodeUrl && !error && (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      )}
    </FormModal>
  );
};

export default MobileUnlockModal;
