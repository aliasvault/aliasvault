import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import ModalWrapper from '@/entrypoints/popup/components/Dialogs/ModalWrapper';

import { MIN_WORD_COUNT, MAX_WORD_COUNT, DEFAULT_WORD_COUNT } from '@/utils/dist/core/models/defaults';
import type {
  PasswordSettings,
  PasswordGeneratorType,
  DicewareCapitalization,
  DicewareSeparator,
  DicewareSalt
} from '@/utils/dist/core/models/vault';
import * as RustCore from '@/utils/RustCore';

const CAPITALIZATION_OPTIONS: DicewareCapitalization[] = ['Lowercase', 'TitleCase', 'Uppercase'];
const SEPARATOR_OPTIONS: DicewareSeparator[] = ['Dash', 'Space', 'Underscore', 'Dot', 'None'];
const SALT_OPTIONS: DicewareSalt[] = ['None', 'Prefix', 'Sprinkle', 'Suffix'];

/**
 * Return the next value in a list of options.
 */
function cycle<T>(options: T[], current: T): T {
  const index = options.indexOf(current);
  return options[(index + 1) % options.length];
}

/**
 * Glyph for the capitalization.
 */
function capitalizationGlyph(value: DicewareCapitalization): string {
  switch (value) {
    case 'Uppercase': return 'ABC';
    case 'TitleCase': return 'Abc';
    default: return 'abc';
  }
}

/**
 * Glyph for the separator.
 */
function separatorGlyph(value: DicewareSeparator): string {
  switch (value) {
    case 'Dash': return '-';
    case 'Space': return '␣';
    case 'Underscore': return '_';
    case 'Dot': return '.';
    default: return '∅';
  }
}

/**
 * Glyph for the salt.
 */
function saltGlyph(value: DicewareSalt): string {
  switch (value) {
    case 'Prefix': return '#ab';
    case 'Sprinkle': return 'a#b';
    case 'Suffix': return 'ab#';
    default: return 'ab';
  }
}

/**
 * Option button class depending on whether default option is selected or not.
 */
function optionButtonClass(customized: boolean): string {
  const base = 'flex items-center justify-center px-2 py-2 rounded-md transition-colors';
  return customized
    ? `${base} bg-primary-600 text-white hover:bg-primary-700`
    : `${base} bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600`;
}

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
  /*
   * Static RNG seed used for generating the same base passphrase for easy comparison when
   * changing options; refreshed on open and when the regenerate button is pressed.
   */
  const [seed, setSeed] = useState<string>('');

  const generatePreview = useCallback(async (currentSettings: PasswordSettings, currentSeed: string): Promise<void> => {
    try {
      const password = await RustCore.generatePassword(currentSettings, currentSeed);
      setPreviewPassword(password);
    } catch (error) {
      console.error('Error generating preview password:', error);
      setPreviewPassword('');
    }
  }, []);

  /*
   * Initialize settings.
   */
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      const newSeed = RustCore.generateSeed();
      setSeed(newSeed);
      setSettings({ ...initialSettings });
      void generatePreview({ ...initialSettings }, newSeed);
    } else if (!isOpen) {
      wasOpenRef.current = false;
    }
  }, [isOpen, initialSettings, generatePreview]);

  const handleSettingChange = useCallback((key: keyof PasswordSettings, value: boolean | number | string) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    // Reuse the same seed so only the changed option affects the preview.
    void generatePreview(newSettings, seed);
    onSettingsChange?.(newSettings);
  }, [settings, seed, generatePreview, onSettingsChange]);

  const handleRefreshPreview = useCallback(() => {
    // The regenerate button produces a genuinely new passphrase.
    const newSeed = RustCore.generateSeed();
    setSeed(newSeed);
    void generatePreview(settings, newSeed);
  }, [settings, generatePreview]);

  const handleSave = useCallback(() => {
    onSave(previewPassword);
    onClose();
  }, [previewPassword, onSave, onClose]);

  /**
   * Human label for a Diceware option value (used in button tooltips).
   */
  const optionLabel = (group: 'Capitalization' | 'Separator' | 'Salt', value: string): string =>
    value === 'None' ? t('common.none') : t(`items.diceware${group}Option.${value}`);

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      showCloseButton={false}
      maxWidth="max-w-lg"
      footer={
        <div className="flex">
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-gray-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-500"
            onClick={handleSave}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13l-3 3m0 0l-3-3m3 3V8m0 13a9 9 0 110-18 9 9 0 010 18z" />
            </svg>
            {t('common.use')}
          </button>
        </div>
      }
    >
      {/*
        Type switcher (Basic | Diceware).
      */}
      <div className="-mx-6 -mt-4 mb-4 flex border-b border-gray-200 dark:border-gray-700">
        {(['basic', 'diceware'] as PasswordGeneratorType[]).map((mode) => {
          const isActive = (settings.Type ?? 'basic') === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => handleSettingChange('Type', mode)}
              className={`-mb-px flex-1 border-b-2 px-3 py-4 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-primary-600 text-primary-600 dark:border-primary-500 dark:text-primary-500'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {mode === 'basic' ? t('items.passwordTypeBasic') : t('items.passwordTypeDiceware')}
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {/* Password Preview */}
        <div>
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
              title={t('common.generate')}
            >
              <svg className="w-4 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
              </svg>
            </button>
          </div>
        </div>

        {/* Basic mode: character type options */}
        {(settings.Type ?? 'basic') !== 'diceware' && (
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
                title={t('items.includeLowercase')}
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
                title={t('items.includeUppercase')}
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
                title={t('items.includeNumbers')}
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
                title={t('items.includeSpecialChars')}
              >
                <span className="font-mono text-base">!@#</span>
              </button>
            </div>

            {/* Avoid Ambiguous Characters */}
            <div className="flex items-center">
              <input
                id="use-non-ambiguous"
                type="checkbox"
                checked={settings.UseNonAmbiguousChars}
                onChange={(e) => handleSettingChange('UseNonAmbiguousChars', e.target.checked)}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600"
              />
              <label htmlFor="use-non-ambiguous" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                {t('items.avoidAmbiguousChars')}
              </label>
            </div>
          </div>
        )}

        {/* Diceware mode: passphrase options */}
        {(settings.Type ?? 'basic') === 'diceware' && (
          <div className="space-y-3">
            {/* Word Count Slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="diceware-word-count" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('items.wordCount')}
                </label>
                <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">
                  {settings.WordCount ?? DEFAULT_WORD_COUNT}
                </span>
              </div>
              <input
                id="diceware-word-count"
                type="range"
                min={MIN_WORD_COUNT}
                max={MAX_WORD_COUNT}
                step="1"
                value={settings.WordCount ?? DEFAULT_WORD_COUNT}
                onChange={(e) => handleSettingChange('WordCount', parseInt(e.target.value, 10))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
              />
            </div>

            {/* Option buttons */}
            <div className="grid grid-cols-3 gap-2">
              {/* Capitalization */}
              <button
                type="button"
                onClick={() => handleSettingChange('Capitalization', cycle(CAPITALIZATION_OPTIONS, settings.Capitalization ?? 'Lowercase'))}
                className={optionButtonClass((settings.Capitalization ?? 'Lowercase') !== 'Lowercase')}
                title={`${optionLabel('Capitalization', settings.Capitalization ?? 'Lowercase')}`}
              >
                <span className="font-mono text-base">{capitalizationGlyph(settings.Capitalization ?? 'Lowercase')}</span>
              </button>

              {/* Separator */}
              <button
                type="button"
                onClick={() => handleSettingChange('Separator', cycle(SEPARATOR_OPTIONS, settings.Separator ?? 'Dash'))}
                className={optionButtonClass((settings.Separator ?? 'Dash') !== 'Dash')}
                title={`${t('items.separator')}: ${optionLabel('Separator', settings.Separator ?? 'Dash')}`}
              >
                <span className="font-mono text-base">{separatorGlyph(settings.Separator ?? 'Dash')}</span>
              </button>

              {/* Salt */}
              <button
                type="button"
                onClick={() => handleSettingChange('Salt', cycle(SALT_OPTIONS, settings.Salt ?? 'None'))}
                className={optionButtonClass((settings.Salt ?? 'None') !== 'None')}
                title={`${t('items.salt')}: ${optionLabel('Salt', settings.Salt ?? 'None')}`}
              >
                <span className="font-mono text-base">{saltGlyph(settings.Salt ?? 'None')}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalWrapper>
  );
};

export default PasswordConfigDialog;
