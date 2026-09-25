import { generatePassword } from '@aliasvault/client/rust/RustCore';
import { MAX_WORD_COUNT, MIN_WORD_COUNT } from '@aliasvault/models/defaults';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PasswordSettingsPopup from '@/components/settings/PasswordSettingsPopup';
import { useDb } from '@/context/DbContext';
import { lengthToSlider, SLIDER_MAX, SLIDER_MIN, sliderToLength } from '@/utils/PasswordLengthSlider';

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
  const tk = 'components.main.settings.passwordSettingsPopup';

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
      <label htmlFor={id} className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">{label}</label>
      <div className="flex">
        <div className="relative flex-grow">
          <input type={isVisible ? 'text' : 'password'} id={id} autoComplete="off" className="outline-0 shadow-sm bg-gray-50 border border-gray-300 text-gray-900 sm:text-sm rounded-l-lg block w-full p-2.5 pr-16 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
        </div>
        <div className="flex">
          <button type="button" className={visibilityButtonClasses} onClick={() => setIsVisible(v => !v)}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              {isVisible ? (
                <>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                </>
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>
              )}
            </svg>
          </button>
          {showGenerateButtons && (
            <>
              <button type="button" id={`${id}-generator-settings`} className="px-3 text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium text-sm border-l border-gray-300 dark:border-gray-700 dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800" onClick={() => setIsSettingsVisible(true)}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                </svg>
              </button>
              <button type="button" className="px-3 text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium rounded-r-lg text-sm border-l border-gray-300 dark:border-gray-700 dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800" onClick={() => settings && void regenerate(settings)}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {showGenerateButtons && settings && (
        <div className="pt-2">
          <div className="flex items-center justify-between mb-1">
            <label htmlFor={`${id}-inline-length`} className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {isDiceware ? t(`${tk}.WordCountLabel`) : t(`${tk}.PasswordLengthLabel`, { 0: settings.Length })}
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
