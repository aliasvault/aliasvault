import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import SecuritySection from '@/components/settings/security/SecuritySection';
import FormLabel from '@/components/shared/FormLabel';
import Select from '@/components/shared/Select';
import { getAutoLockTimeout, setAutoLockTimeout } from '@/hooks/useAutoLock';

/**
 * How long the vault may stay idle before this browser locks it.
 */
const AutoLockSection: React.FC = () => {
  const { t } = useTranslation();
  const [timeout, setTimeoutState] = useState(() => String(getAutoLockTimeout()));

  /**
   * Store the new timeout in this browser.
   */
  const update = (value: string): void => {
    setTimeoutState(value);
    setAutoLockTimeout(Number(value));
  };

  return (
    <SecuritySection title={t('settings.autoLock')}>
      <div>
        <FormLabel htmlFor="autoLockTimeout">{t('settings.autoLock')}</FormLabel>
        <Select id="autoLockTimeout" value={timeout} onChange={(e) => update(e.target.value)}>
          <option value="0">{t('common.never')}</option>
          <option value="60">{t('settings.autoLockOptions.1minute')}</option>
          <option value="300">{t('settings.autoLockOptions.5minutes')}</option>
          <option value="900">{t('settings.autoLockOptions.15minutes')}</option>
          <option value="1800">{t('settings.autoLockOptions.30minutes')}</option>
          <option value="3600">{t('settings.autoLockOptions.1hour')}</option>
          <option value="14400">{t('settings.autoLockOptions.4hours')}</option>
          <option value="28800">{t('settings.autoLockOptions.8hours')}</option>
          <option value="86400">{t('settings.autoLockOptions.24hours')}</option>
        </Select>
        <span className="block mt-2 text-sm text-gray-500 dark:text-gray-400">{t('settings.autoLockTimeoutDescription')}</span>
      </div>
    </SecuritySection>
  );
};

export default AutoLockSection;
