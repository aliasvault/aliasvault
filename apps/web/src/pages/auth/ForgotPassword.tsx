import React from 'react';
import { useTranslation } from 'react-i18next';

import { getAppConfig } from '@/config/AppConfig';
import { usePageTitle } from '@/hooks/usePageTitle';

/** Marker put in the support string's placeholder so the mail link can be replaced. */
const EMAIL_MARKER = '%%EMAIL%%';

/**
 * The lost password page: there is no recovery, only advice.
 */
const ForgotPassword: React.FC = () => {
  const { t } = useTranslation();
  const tk = 'pages.auth.forgotPassword';
  usePageTitle(t(`${tk}.LostPasswordTitle`));
  const supportEmail = getAppConfig().supportEmail;
  const [before, after] = t(`${tk}.ContactSupportWithEmail`, { 0: EMAIL_MARKER }).split(EMAIL_MARKER);

  return (
    <>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t(`${tk}.LostPasswordTitle`)}</h2>
      <div className="text-sm space-y-4 text-gray-500 dark:text-gray-400">
        <p>{t(`${tk}.NoRecoveryExplanation`)}</p>
        <p>{t(`${tk}.NewAccountRequired`)}</p>
        <div>
          <h3 className="font-medium mb-2 text-gray-900 dark:text-white">{t(`${tk}.RecentlyChangedPasswordTitle`)}</h3>
          {supportEmail.length > 0
            ? <p>{before}<a href={`mailto:${supportEmail}`} className="text-primary-600 hover:underline dark:text-primary-400">{supportEmail}</a>{after ?? ''}</p>
            : <p>{t(`${tk}.ContactAdministrator`)}</p>}
        </div>
      </div>
    </>
  );
};

export default ForgotPassword;
