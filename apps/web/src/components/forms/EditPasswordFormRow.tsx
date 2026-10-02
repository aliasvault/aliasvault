import { generatePassword } from '@aliasvault/client/rust/RustCore';
import { lengthToSlider, SLIDER_MAX, SLIDER_MIN, sliderToLength } from '@aliasvault/client/utilities/PasswordLengthSlider';
import { MAX_WORD_COUNT, MIN_WORD_COUNT } from '@aliasvault/models/defaults';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FormInput from '@/components/forms/FormInput';
import PasswordSettingsPopup from '@/components/settings/PasswordSettingsPopup';
import FormLabel from '@/components/shared/FormLabel';
import Icon from '@/components/shared/Icon';
import { useDb } from '@/context/DbContext';

import type { PasswordSettings } from '@aliasvault/models/vault';

type EditPasswordFormRowProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Show the value in clear text; a generated password always shows. */
  showPassword?: boolean;
  showGenerateButtons?: boolean;
};

/**
 * Password input with show/hide, generator settings, a generate button and the inline length slider.
 */
const EditPasswordFormRow: React.FC<EditPasswordFormRowProps> = ({ id, label, value, onChange, placeholder = '', showPassword = false, showGenerateButtons = true }) => {
  const { t } = useTranslation();
  const dbContext = useDb();
  const [isVisible, setIsVisible] = useState(showPassword);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [settings, setSettings] = useState<PasswordSettings | null>(null);
  const [sliderValue, setSliderValue] = useState(0);

  useEffect(() => {
    if (showPassword) {
      setIsVisible(true);
    }
  }, [showPassword]);

  useEffect(() => {
    const stored = dbContext.sqliteClient?.settings.getPasswordSettings();
    if (stored) {
      setSettings(stored);
      setSliderValue(lengthToSlider(stored.Length));
    }
  }, [dbContext.sqliteClient]);

  const isDiceware = settings?.Type === 'diceware';

  /**
   * Generate a password with the current settings and show it.
   */
  const regenerate = async (current: PasswordSettings): Promise<void> => {
    onChange(await generatePassword(current));
    setIsVisible(true);
  };

  /**
   * Take over the settings chosen in the popup and its generated password.
   */
  const handleSettingsSaved = (saved: PasswordSettings, generated: string): void => {
    setSettings(saved);
    setSliderValue(lengthToSlider(saved.Length));
    setIsVisible(true);
    onChange(generated);
  };

  const visibilityButtonClasses = `px-3 text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium text-sm dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800${showGenerateButtons ? '' : ' rounded-r-lg'}`;

  return (
    <>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <div className="flex">
        <div className="relative flex-grow">
          <FormInput type={isVisible ? 'text' : 'password'} id={id} attached="right" trailingSpace="lg" value={value} onValueChange={onChange} placeholder={placeholder} />
        </div>
        <div className="flex">
          <button type="button" className={visibilityButtonClasses} onClick={() => setIsVisible(v => !v)}>
            <Icon name={isVisible ? 'eye' : 'eye-off'} className="w-5 h-5" />
          </button>
          {showGenerateButtons && (
            <>
              <button type="button" id={`${id}-generator-settings`} className="px-3 text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium text-sm border-l border-gray-300 dark:border-gray-700 dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800" onClick={() => setIsSettingsVisible(true)}>
                <Icon name="cog" className="w-5 h-5" />
              </button>
              <button type="button" className="px-3 text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium rounded-r-lg text-sm border-l border-gray-300 dark:border-gray-700 dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800" onClick={() => settings && void regenerate(settings)}>
                <Icon name="refresh" className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>

      {showGenerateButtons && settings && (
        <div className="pt-2">
          <div className="flex items-center justify-between mb-1">
            <label htmlFor={`${id}-inline-length`} className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {isDiceware ? t('items.wordCount') : t('items.passwordSettingsPopup.passwordLengthLabel', { length: settings.Length })}
            </label>
            {isDiceware && <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">{settings.WordCount}</span>}
          </div>
          {isDiceware ? (
            <input type="range" id={`${id}-inline-length`} min={MIN_WORD_COUNT} max={MAX_WORD_COUNT} step="1" className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 av-range-slider" value={settings.WordCount} onChange={(e) => {
              const next = { ...settings, WordCount: Number.parseInt(e.target.value, 10) };
              setSettings(next);
              void regenerate(next);
            }} />
          ) : (
            <input type="range" id={`${id}-inline-length`} min={SLIDER_MIN} max={SLIDER_MAX} step="0.1" className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 av-range-slider" value={sliderValue} onChange={(e) => {
              const slider = Number.parseFloat(e.target.value);
              setSliderValue(slider);
              const next = { ...settings, Length: sliderToLength(slider) };
              setSettings(next);
              void regenerate(next);
            }} />
          )}
        </div>
      )}

      {isSettingsVisible && settings && (
        <PasswordSettingsPopup passwordSettings={settings} isTemporary onSaveSettings={handleSettingsSaved} onClose={() => setIsSettingsVisible(false)} />
      )}
    </>
  );
};

export default EditPasswordFormRow;
