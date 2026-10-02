import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SecuritySection from '@/components/settings/security/SecuritySection';
import FormLabel from '@/components/shared/FormLabel';
import Select from '@/components/shared/Select';
import { useDb } from '@/context/DbContext';
import { useVaultMutate } from '@/hooks/useVaultMutate';

/**
 * How long copied secrets stay on the clipboard.
 */
const ClipboardClearSection: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const { executeVaultMutationInBackground } = useVaultMutate();
  const [clipboardClearSeconds, setClipboardClearSeconds] = useState('10');

  useEffect(() => {
    if (dbContext.sqliteClient) {
      setClipboardClearSeconds(dbContext.sqliteClient.settings.getSetting('ClipboardClearSeconds', '10'));
    }
  }, [dbContext.sqliteClient]);

  /**
   * Store the new timeout in the vault.
   */
  const update = async (value: string): Promise<void> => {
    setClipboardClearSeconds(value);
    await executeVaultMutationInBackground(async () => {
      dbContext.sqliteClient?.settings.updateSetting('ClipboardClearSeconds', value);
    });
  };

  return (
    <SecuritySection title={t('settings.clipboardClear')}>
      <div className="mb-4">
        <FormLabel htmlFor="clipboardClearSeconds">{t('settings.general.clipboardClearSecondsLabel')}</FormLabel>
        <Select id="clipboardClearSeconds" value={clipboardClearSeconds} onChange={(e) => void update(e.target.value)}>
          <option value="0">{t('common.disabled')}</option>
          <option value="5">{t('common.duration.5seconds')}</option>
          <option value="10">{t('settings.clipboardClearOptions.10seconds')}</option>
          <option value="15">{t('common.duration.15seconds')}</option>
        </Select>
        <span className="block text-sm font-normal text-gray-500 dark:text-gray-400">{t('settings.general.clipboardClearSecondsDescription')}</span>
        <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg dark:bg-amber-900/20 dark:border-amber-800">
          <p className="text-sm text-amber-800 dark:text-amber-200">{t('settings.general.clipboardClearLimitationNote')}</p>
        </div>
      </div>
    </SecuritySection>
  );
};

export default ClipboardClearSection;
