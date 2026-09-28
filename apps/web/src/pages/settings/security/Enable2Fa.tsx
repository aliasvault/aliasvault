import QRCode from 'qrcode';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import LoadingIndicator from '@/components/loading/LoadingIndicator';
import Breadcrumb from '@/components/shared/Breadcrumb';
import Card from '@/components/shared/Card';
import H1 from '@/components/shared/H1';
import { useNotifications } from '@/context/NotificationContext';
import { useWebApi } from '@/context/WebApiContext';
import { usePageTitle } from '@/hooks/usePageTitle';

/**
 * The recovery codes shown once after enabling two-factor authentication.
 */
const ShowRecoveryCodes: React.FC<{ recoveryCodes: string[] }> = ({ recoveryCodes }) => {
  const { t } = useTranslation();
  
  return (
    <div className="max-w-2xl mx-auto px-4 lg:mt-8">
      <Card variant="plain">
        <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">{t('settings.securitySettings.recoveryCodes.title')}</h3>
        <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">{t('settings.securitySettings.recoveryCodes.description')}</div>
        <div className="bg-primary-100 border-l-4 border-primary-500 text-primary-700 p-4 mb-4 dark:bg-gray-700 dark:border-primary-500 dark:text-gray-200">
          <p className="font-semibold">{t('settings.securitySettings.recoveryCodes.warningTitle')}</p>
          <p>{t('settings.securitySettings.recoveryCodes.warningDescription')}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2" id="recovery-codes">
          {recoveryCodes.map(code => (
            <div key={code}>
              <code className="block p-3 bg-gray-100 dark:bg-gray-700 dark:text-gray-200 rounded border font-mono text-center">{code}</code>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

/**
 * The enable two-factor authentication page.
 */
const Enable2Fa: React.FC = () => {
  const { t } = useTranslation();
  const webApi = useWebApi();
  const notifications = useNotifications();
  usePageTitle(t('settings.securitySettings.enable2fa.pageTitle'));

  const [isLoading, setIsLoading] = useState(true);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    /**
     * Ask the server for a new authenticator secret and render it as a QR code.
     */
    const setup = async (): Promise<void> => {
      try {
        const result = await webApi.post<null, { secret: string; qrCodeUrl: string }>('TwoFactorAuth/enable', null);
        // Spaces every four characters make the secret easier to type over.
        setSecret((result.secret.match(/.{1,4}/g) ?? []).join(' ').toLowerCase());
        setQrCodeDataUrl(await QRCode.toDataURL(result.qrCodeUrl, { width: 256, margin: 2 }));
      } catch (error) {
        console.error('Failed to start 2FA setup:', error);
        notifications.addErrorMessage(t('settings.securitySettings.enable2fa.failedToEnable2Fa'), true);
      } finally {
        setIsLoading(false);
      }
    };
    void setup();
  }, [notifications, t, webApi]);

  /**
   * Verify the first code and switch two-factor on.
   */
  const verifySetup = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      const result = await webApi.post<string, { recoveryCodes: string[] }>('TwoFactorAuth/verify', code);
      notifications.addSuccessMessage(t('settings.securitySettings.enable2fa.twoFactorEnabledSuccess'), true);
      setRecoveryCodes(result.recoveryCodes);
    } catch (error) {
      console.error('Failed to verify 2FA code:', error);
      notifications.addErrorMessage(t('settings.securitySettings.enable2fa.failedToEnable2Fa'), true);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 px-4 pt-6 xl:grid-cols-3 xl:gap-4 dark:bg-gray-900">
        <div className="mb-4 col-span-full xl:mb-2">
          <Breadcrumb items={[{ displayName: t('common.home'), url: '/', showHomeIcon: true }, { displayName: t('settings.securitySettings.pageTitle'), url: '/settings/security' }, { displayName: t('settings.securitySettings.enable2fa.pageTitle') }]} />
          <H1>{t('settings.securitySettings.enable2fa.pageTitle')}</H1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('settings.securitySettings.enable2fa.pageDescription')}</p>
        </div>
      </div>

      {isLoading ? <LoadingIndicator /> : recoveryCodes !== null ? <ShowRecoveryCodes recoveryCodes={recoveryCodes} /> : (
        <div className="max-w-2xl mx-auto px-4 lg:mt-8">
          <Card variant="plain">
            <div className="space-y-6">
              <div id="authenticator-uri" className="flex justify-center">
                {qrCodeDataUrl.length > 0 && <img src={qrCodeDataUrl} alt={t('common.qrCode')} className="w-64 h-64" />}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 text-center">{t('settings.securitySettings.enable2fa.qrCodeInstructions')}</p>
              <div className="text-lg font-mono text-center bg-gray-100 dark:bg-gray-700 p-3 rounded border dark:text-gray-200" id="authenticator-secret">{secret}</div>

              <form onSubmit={verifySetup} className="space-y-4" av-enable="true" av-suppress-save="true">
                <div>
                  <input id="verificationCode" type="text" value={code} onChange={e => setCode(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400" placeholder={t('settings.securitySettings.enable2fa.verificationCodePlaceholder')} autoComplete="one-time-code" />
                </div>
                <button type="submit" className="w-full bg-primary-500 text-white py-2 px-4 rounded-md hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 transition duration-150 ease-in-out">
                  {t('settings.securitySettings.enable2fa.verifyAndEnableButton')}
                </button>
              </form>
            </div>
          </Card>
        </div>
      )}
    </>
  );
};

export default Enable2Fa;
