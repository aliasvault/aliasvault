import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { PasswordSettings } from '@/utils/dist/shared/models/vault';
import { CreatePasswordGenerator } from '@/utils/dist/shared/password-generator';

interface IPasswordConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (password: string) => void;
  onSettingsChange?: (settings: PasswordSettings) => void;
  initialSettings: PasswordSettings;
}

/**
 * Password configuration dialog component.
 */
const PasswordConfigDialog: React.FC<IPasswordConfigDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  onSettingsChange,
  initialSettings
}) => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<PasswordSettings>(initialSettings);
  const [previewPassword, setPreviewPassword] = useState<string>('');

  const generatePreview = useCallback((currentSettings: PasswordSettings) => {
    try {
      const passwordGenerator = CreatePasswordGenerator(currentSettings);
      const password = passwordGenerator.generateRandomPassword();
      setPreviewPassword(password);
    } catch (error) {
      console.error('Error generating preview password:', error);
      setPreviewPassword('');
    }
  }, []);

  // Initialize settings when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSettings({ ...initialSettings });
      generatePreview({ ...initialSettings });
    }
  }, [isOpen, initialSettings, generatePreview]);

  const handleSettingChange = useCallback((key: keyof PasswordSettings, value: boolean | number) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    generatePreview(newSettings);
    onSettingsChange?.(newSettings);
  }, [settings, generatePreview, onSettingsChange]);

  const handleRefreshPreview = useCallback(() => {
    generatePreview(settings);
  }, [settings, generatePreview]);

  const handleSave = useCallback(() => {
    onSave(previewPassword);
    onClose();
  }, [previewPassword, onSave, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-60 transition-opacity" onClick={handleCancel} />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="relative transform overflow-hidden rounded-lg bg-white dark:bg-gray-800 px-4 pb-4 pt-5 text-left shadow-xl transition-all w-full max-w-lg">
          {/* Close button */}
          <button
            type="button"
            className="absolute right-4 top-4 text-gray-400 hover:text-gray-500 focus:outline-none"
            onClick={handleCancel}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Modal content */}
          <div className="sm:flex sm:items-start">
            <div className="w-full mt-3 text-center sm:ml-4 sm:mt-0 sm:text-left">
              <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white mb-4">
                {t('credentials.changePasswordComplexity')}
              </h3>

              <div className="space-y-4">
                {/* Password Preview */}
                <div className="mt-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={previewPassword}
                      readOnly
                      className="flex-1 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleRefreshPreview}
                      className="px-3 py-2 text-sm text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium rounded-lg dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800"
                      title={t('credentials.generateNewPreview')}
                    >
                      <svg className="w-4 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Character Type Toggle Buttons */}
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {/* Lowercase Toggle */}
                    <button
                      type="button"
                      onClick={() => handleSettingChange('UseLowercase', !settings.UseLowercase)}
                      className={`flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        settings.UseLowercase
                          ? 'bg-primary-600 text-white hover:bg-primary-700'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                      }`}
                      title={t('credentials.includeLowercase')}
                    >
                      <span className="font-mono text-base">a-z</span>
                    </button>

                    {/* Uppercase Toggle */}
                    <button
                      type="button"
                      onClick={() => handleSettingChange('UseUppercase', !settings.UseUppercase)}
                      className={`flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        settings.UseUppercase
                          ? 'bg-primary-600 text-white hover:bg-primary-700'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                      }`}
                      title={t('credentials.includeUppercase')}
                    >
                      <span className="font-mono text-base">A-Z</span>
                    </button>

                    {/* Numbers Toggle */}
                    <button
                      type="button"
                      onClick={() => handleSettingChange('UseNumbers', !settings.UseNumbers)}
                      className={`flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        settings.UseNumbers
                          ? 'bg-primary-600 text-white hover:bg-primary-700'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                      }`}
                      title={t('credentials.includeNumbers')}
                    >
                      <span className="font-mono text-base">0-9</span>
                    </button>

                    {/* Special Characters Toggle */}
                    <button
                      type="button"
                      onClick={() => handleSettingChange('UseSpecialChars', !settings.UseSpecialChars)}
                      className={`flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        settings.UseSpecialChars
                          ? 'bg-primary-600 text-white hover:bg-primary-700'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                      }`}
                      title={t('credentials.includeSpecialChars')}
                    >
                      <span className="font-mono text-base">!@#</span>
                    </button>
                  </div>

                  {/* Avoid Ambiguous Characters - Checkbox */}
                  <div className="flex items-center">
                    <input
                      id="use-non-ambiguous"
                      type="checkbox"
                      checked={settings.UseNonAmbiguousChars}
                      onChange={(e) => handleSettingChange('UseNonAmbiguousChars', e.target.checked)}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600"
                    />
                    <label htmlFor="use-non-ambiguous" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                      {t('credentials.avoidAmbiguousChars')}
                    </label>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-5 sm:mt-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  className="inline-flex w-full justify-center items-center gap-1 rounded-md bg-gray-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-500 sm:ml-3 sm:w-auto"
                  onClick={handleSave}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13l-3 3m0 0l-3-3m3 3V8m0 13a9 9 0 110-18 9 9 0 010 18z" />
                  </svg>
                  {t('common.use')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PasswordConfigDialog;