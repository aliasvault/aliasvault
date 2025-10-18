import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import PasswordConfigDialog from '@/entrypoints/popup/components/Dialogs/PasswordConfigDialog';
import { useDb } from '@/entrypoints/popup/context/DbContext';

import type { PasswordSettings } from '@/utils/dist/shared/models/vault';
import { CreatePasswordGenerator } from '@/utils/dist/shared/password-generator';

interface IPasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  showPassword?: boolean;
  onShowPasswordChange?: (show: boolean) => void;
}

/**
 * Password field component with inline length slider and advanced configuration.
 */
const PasswordField: React.FC<IPasswordFieldProps> = ({
  id,
  label,
  value,
  onChange,
  placeholder,
  error,
  showPassword: controlledShowPassword,
  onShowPasswordChange
}) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const [internalShowPassword, setInternalShowPassword] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [currentSettings, setCurrentSettings] = useState<PasswordSettings | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Use controlled or uncontrolled showPassword state
  const showPassword = controlledShowPassword !== undefined ? controlledShowPassword : internalShowPassword;

  /**
   * Set the showPassword state.
   */
  const setShowPassword = useCallback((show: boolean): void => {
    if (controlledShowPassword !== undefined) {
      onShowPasswordChange?.(show);
    } else {
      setInternalShowPassword(show);
    }
  }, [controlledShowPassword, onShowPasswordChange]);

  // Load password settings from database
  useEffect(() => {
    /**
     * Load password settings from the database.
     */
    const loadSettings = async (): Promise<void> => {
      try {
        if (dbContext.sqliteClient) {
          const settings = dbContext.sqliteClient.getPasswordSettings();
          setCurrentSettings(settings);
          setIsLoaded(true);
        }
      } catch (error) {
        console.error('Error loading password settings:', error);
      }
    };
    void loadSettings();
  }, [dbContext.sqliteClient]);

  const generatePassword = useCallback((settings: PasswordSettings) => {
    try {
      const passwordGenerator = CreatePasswordGenerator(settings);
      const password = passwordGenerator.generateRandomPassword();
      onChange(password);
      setShowPassword(true);
    } catch (error) {
      console.error('Error generating password:', error);
    }
  }, [onChange, setShowPassword]);

  const handleLengthChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentSettings) {
      return;
    }
    const length = parseInt(e.target.value, 10);
    const newSettings = { ...currentSettings, Length: length };
    setCurrentSettings(newSettings);

    // Always generate password when length changes
    generatePassword(newSettings);
  }, [currentSettings, generatePassword]);

  const handleRegeneratePassword = useCallback(() => {
    if (!currentSettings) {
      return;
    }
    generatePassword(currentSettings);
  }, [generatePassword, currentSettings]);

  const handleConfiguredPassword = useCallback((password: string) => {
    onChange(password);
    setShowPassword(true);
  }, [onChange, setShowPassword]);

  const handleAdvancedSettingsChange = useCallback((newSettings: PasswordSettings) => {
    setCurrentSettings(newSettings);
  }, []);

  const togglePasswordVisibility = useCallback(() => {
    setShowPassword(!showPassword);
  }, [showPassword, setShowPassword]);

  const openConfigDialog = useCallback(() => {
    setShowConfigDialog(true);
  }, []);

  // Don't render until settings are loaded
  if (!currentSettings || !isLoaded) {
    return (
      <div className="space-y-2">
        <label htmlFor={id} className="block text-sm font-medium text-gray-900 dark:text-white">
          {label}
        </label>
        <div className="animate-pulse bg-gray-200 dark:bg-gray-700 h-10 rounded-lg"></div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Label */}
      <label htmlFor={id} className="block text-sm font-medium text-gray-900 dark:text-white">
        {label}
      </label>

      {/* Password Input with Buttons */}
      <div className="flex">
        <div className="relative flex-grow">
          <input
            type={showPassword ? 'text' : 'password'}
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="outline-0 text-sm shadow-sm border border-gray-300 bg-gray-50 text-gray-900 sm:text-sm rounded-l-lg block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
          />
        </div>
        <div className="flex">
          {/* Show/Hide Password Button */}
          <button
            type="button"
            onClick={togglePasswordVisibility}
            className="px-3 text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium text-sm dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800"
            title={showPassword ? t('common.hidePassword') : t('common.showPassword')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {showPassword ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              ) : (
                <>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </>
              )}
            </svg>
          </button>

          {/* Generate Password Button */}
          <button
            type="button"
            onClick={handleRegeneratePassword}
            className="px-3 text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium rounded-r-lg text-sm border-l border-gray-300 dark:border-gray-700 dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800"
            title={t('credentials.generateRandomPassword')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Inline Password Length Slider */}
      <div className="pt-2">
        <div className="flex items-center justify-between mb-2">
          <label htmlFor={`${id}-length`} className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('credentials.passwordLength')}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">
              {currentSettings.Length}
            </span>
            <button
              type="button"
              onClick={openConfigDialog}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              title={t('credentials.changePasswordComplexity')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
        <input
          type="range"
          id={`${id}-length`}
          min="8"
          max="64"
          value={currentSettings.Length}
          onChange={handleLengthChange}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
        />
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Advanced Configuration Dialog */}
      <PasswordConfigDialog
        isOpen={showConfigDialog}
        onClose={() => setShowConfigDialog(false)}
        onSave={handleConfiguredPassword}
        onSettingsChange={handleAdvancedSettingsChange}
        initialSettings={currentSettings}
      />
    </div>
  );
};

export default PasswordField;