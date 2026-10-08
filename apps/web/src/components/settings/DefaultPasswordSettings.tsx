import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PasswordSettingsPopup from '@/components/settings/PasswordSettingsPopup';
import FormLabel from '@/components/shared/FormLabel';
import { useDb } from '@/context/DbContext';

import type { PasswordSettings } from '@aliasvault/models/vault';

/**
 * Button that opens the password generator settings popup for the vault defaults.
 */
const DefaultPasswordSettings: React.FC = () => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const [settings, setSettings] = useState<PasswordSettings | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setSettings(dbContext.sqliteClient?.settings.getPasswordSettings() ?? null);
  }, [dbContext.sqliteClient]);

  return (
    <div>
      <FormLabel htmlFor="password-generator-settings-modal">{t('settings.passwordGeneratorSettings.passwordGeneratorSettingsLabel')}</FormLabel>
      <button type="button" id="password-generator-settings-modal" className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-primary-700 dark:hover:bg-primary-600" onClick={() => setIsVisible(true)}>
        {t('settings.passwordGeneratorSettings.configureButton')}
      </button>
      <span className="block mt-2 text-sm text-gray-500 dark:text-gray-400">{t('settings.passwordGeneratorSettings.description')}</span>

      {isVisible && settings && (
        <PasswordSettingsPopup passwordSettings={settings} isTemporary={false} onSaveSettings={(saved) => setSettings(saved)} onClose={() => setIsVisible(false)} />
      )}
    </div>
  );
};

export default DefaultPasswordSettings;
