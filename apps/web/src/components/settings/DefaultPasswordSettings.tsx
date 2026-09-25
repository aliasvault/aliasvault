import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PasswordSettingsPopup from '@/components/settings/PasswordSettingsPopup';
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
  const tk = 'components.main.settings.defaultPasswordSettings';

  useEffect(() => {
    setSettings(dbContext.sqliteClient?.settings.getPasswordSettings() ?? null);
  }, [dbContext.sqliteClient]);

  return (
    <div className="mb-4">
      <label htmlFor="password-generator-settings-modal" className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{t(`${tk}.PasswordGeneratorSettingsLabel`)}</label>
      <button type="button" id="password-generator-settings-modal" className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-primary-700 dark:hover:bg-primary-600" onClick={() => setIsVisible(true)}>
        {t(`${tk}.ConfigureButton`)}
      </button>
      <span className="block text-sm font-normal text-gray-500 truncate dark:text-gray-400 mt-2">{t(`${tk}.PasswordGeneratorSettingsDescription`)}</span>

      {isVisible && settings && (
        <PasswordSettingsPopup passwordSettings={settings} isTemporary={false} onSaveSettings={(saved) => setSettings(saved)} onClose={() => setIsVisible(false)} />
      )}
    </div>
  );
};

export default DefaultPasswordSettings;
