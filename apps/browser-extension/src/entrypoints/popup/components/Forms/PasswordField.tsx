import * as RustCore from '@aliasvault/client/rust/RustCore';
import { sliderToLength, lengthToSlider, SLIDER_MIN, SLIDER_MAX } from '@aliasvault/client/utilities/PasswordLengthSlider';
import { MIN_WORD_COUNT, MAX_WORD_COUNT, DEFAULT_WORD_COUNT } from '@aliasvault/models/defaults';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import PasswordConfigDialog from '@/entrypoints/popup/components/Dialogs/PasswordConfigDialog';
import Icon from '@/entrypoints/popup/components/Icons/Icon';
import { useDb } from '@/entrypoints/popup/context/DbContext';

import { logFailure } from '@/utils/Diagnostics';

import type { PasswordSettings } from '@aliasvault/models/vault';

interface IPasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  showPassword?: boolean;
  onShowPasswordChange?: (show: boolean) => void;
  /** Initial password settings to use (e.g., from persisted form state) */
  initialSettings?: PasswordSettings;
  /** Callback when password settings change */
  onSettingsChange?: (settings: PasswordSettings) => void;
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
  onShowPasswordChange,
  initialSettings,
  onSettingsChange
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
     * If initialSettings is provided (e.g., from persisted form state), use it instead of the database default.
     */
    const loadSettings = async (): Promise<void> => {
      try {
        if (dbContext.sqliteClient) {
          // Use initialSettings if provided, otherwise use database settings
          if (initialSettings !== undefined) {
            setCurrentSettings(initialSettings);
          } else {
            const settings = dbContext.sqliteClient.settings.getPasswordSettings();
            setCurrentSettings(settings);
          }
          setIsLoaded(true);
        }
      } catch (error) {
        logFailure('Error loading password settings', error);
      }
    };
    void loadSettings();
  }, [dbContext.sqliteClient, initialSettings]);

  const generatePassword = useCallback(async (settings: PasswordSettings): Promise<void> => {
    try {
      const password = await RustCore.generatePassword(settings);
      onChange(password);
      setShowPassword(true);
    } catch (error) {
      logFailure('Error generating password', error);
    }
  }, [onChange, setShowPassword]);

  const isDiceware = currentSettings?.Type === 'diceware';

  const handleLengthChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentSettings) {
      return;
    }
    const sliderValue = parseFloat(e.target.value);
    const length = sliderToLength(sliderValue);
    const newSettings = { ...currentSettings, Length: length };
    setCurrentSettings(newSettings);

    // Notify parent of settings change for persistence
    onSettingsChange?.(newSettings);

    // Always generate password when length changes
    void generatePassword(newSettings);
  }, [currentSettings, generatePassword, onSettingsChange]);

  const handleWordCountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentSettings) {
      return;
    }
    const wordCount = parseInt(e.target.value, 10);
    const newSettings = { ...currentSettings, WordCount: wordCount };
    setCurrentSettings(newSettings);

    // Notify parent of settings change for persistence
    onSettingsChange?.(newSettings);

    // Always regenerate passphrase when word count changes
    void generatePassword(newSettings);
  }, [currentSettings, generatePassword, onSettingsChange]);

  const handleRegeneratePassword = useCallback(() => {
    if (!currentSettings) {
      return;
    }
    void generatePassword(currentSettings);
  }, [generatePassword, currentSettings]);

  const handleConfiguredPassword = useCallback((password: string) => {
    onChange(password);
    setShowPassword(true);
  }, [onChange, setShowPassword]);

  const handleAdvancedSettingsChange = useCallback((newSettings: PasswordSettings) => {
    setCurrentSettings(newSettings);
    // Notify parent of settings change for persistence
    onSettingsChange?.(newSettings);
  }, [onSettingsChange]);

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
            <Icon name={showPassword ? 'eye-off' : 'eye'} className="w-5 h-5" />
          </button>

          {/* Generate Password Button */}
          <button
            type="button"
            onClick={handleRegeneratePassword}
            className="px-3 text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium rounded-r-lg text-sm border-l border-gray-300 dark:border-gray-700 dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800"
            title={t('common.generate')}
          >
            <Icon name="refresh" className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Inline Slider: password length (basic) or word count (diceware) */}
      <div className="pt-2">
        <div className="flex items-center justify-between mb-2">
          <label htmlFor={`${id}-length`} className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {isDiceware ? t('items.wordCount') : t('items.passwordLength')}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">
              {isDiceware ? (currentSettings.WordCount ?? DEFAULT_WORD_COUNT) : currentSettings.Length}
            </span>
            <button
              type="button"
              onClick={openConfigDialog}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              title={t('items.changePasswordComplexity')}
            >
              <Icon name="cog" className="w-5 h-5" />
            </button>
          </div>
        </div>
        {isDiceware ? (
          <input
            type="range"
            id={`${id}-length`}
            min={MIN_WORD_COUNT}
            max={MAX_WORD_COUNT}
            step="1"
            value={currentSettings.WordCount ?? DEFAULT_WORD_COUNT}
            onChange={handleWordCountChange}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
          />
        ) : (
          <input
            type="range"
            id={`${id}-length`}
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step="0.1"
            value={lengthToSlider(currentSettings.Length)}
            onChange={handleLengthChange}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
          />
        )}
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