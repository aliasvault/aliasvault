import React from 'react';
import { useTranslation } from 'react-i18next';

import { getAppConfig } from '@/config/AppConfig';

/** Marker put in the string's placeholder so the mail link can be put in its place. */
const EMAIL_MARKER = '%%EMAIL%%';

/**
 * The configured support address as a mail link, prefilled with the error report. Renders empty without an address.
 */
const SupportContact: React.FC<{ report?: string | null; className?: string }> = ({ report, className = '' }) => {
  const { t } = useTranslation();
  const supportEmail = getAppConfig().supportEmail;
  if (supportEmail.length === 0) {
    return null;
  }

  const [before, after] = t('common.errors.contactSupportAt', { email: EMAIL_MARKER }).split(EMAIL_MARKER);
  const href = report ? `mailto:${supportEmail}?body=${encodeURIComponent(report)}` : `mailto:${supportEmail}`;
  return (
    <p id="support-contact" className={`text-sm text-gray-500 dark:text-gray-400 ${className}`.trim()}>
      {before}<a href={href} className="text-primary-600 hover:underline dark:text-primary-400">{supportEmail}</a>{after ?? ''}
    </p>
  );
};

export default SupportContact;
