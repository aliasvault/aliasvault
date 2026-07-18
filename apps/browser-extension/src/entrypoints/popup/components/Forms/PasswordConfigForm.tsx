import React from 'react';
import { useTranslation } from 'react-i18next';

import { MIN_WORD_COUNT, MAX_WORD_COUNT, DEFAULT_WORD_COUNT, getLanguageInfo, resolveDefaultLanguage } from '@/utils/dist/core/models/defaults';
import type {
  PasswordSettings,
  PasswordGeneratorType,
  DicewareCapitalization,
  DicewareSeparator,
  DicewareSalt
} from '@/utils/dist/core/models/vault';
import { sliderToLength, lengthToSlider, SLIDER_MIN, SLIDER_MAX } from '@/utils/PasswordLengthSlider';

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

interface IPasswordConfigFormProps {
  settings: PasswordSettings;
  previewPassword: string;
  dicewareLanguages: string[];
  onSettingChange: (key: keyof PasswordSettings, value: boolean | number | string) => void;
  onRefreshPreview: () => void;
  /**
   * Negative-margin utility classes used to make the type switcher span the container's padding.
   * Defaults to the modal padding (`px-6 pt-4`); pass `-mx-4 -mt-4` when embedded in a `p-4` card.
   */
  edgeMarginClass?: string;
  /**
   * Whether to show the passphrase language dropdown in the Diceware section. Defaults to true.
   * Set to false where the language is configured separately (e.g. the settings page).
   */
  showLanguagePicker?: boolean;
}

/**
 * Controlled password generator configuration form (type switcher, preview, basic and Diceware
 * options including the passphrase language dropdown). State is owned by the parent
 * (see {@link import('@/entrypoints/popup/hooks/usePasswordConfig').usePasswordConfig}).
 */
const PasswordConfigForm: React.FC<IPasswordConfigFormProps> = ({
  settings,
  previewPassword,
  dicewareLanguages,
  onSettingChange,
  onRefreshPreview,
  edgeMarginClass = '-mx-6 -mt-4',
  showLanguagePicker = true
}) => {
  const { t } = useTranslation();

  const isDiceware = (settings.Type ?? 'basic') === 'diceware';
  const currentLanguage = (settings.Language && settings.Language.length > 0)
    ? settings.Language
    : resolveDefaultLanguage(navigator.language, dicewareLanguages);

  /**
   * Human label for a Diceware option value (used in button tooltips).
   */
  const optionLabel = (group: 'Capitalization' | 'Separator' | 'Salt', value: string): string =>
    value === 'None' ? t('common.none') : t(`items.diceware${group}Option.${value}`);

  return (
    <>
      {/* Type switcher (Basic | Diceware). */}
      <div className={`${edgeMarginClass} mb-4 flex border-b border-gray-200 dark:border-gray-700`}>
        {(['basic', 'diceware'] as PasswordGeneratorType[]).map((mode) => {
          const isActive = (settings.Type ?? 'basic') === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onSettingChange('Type', mode)}
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
              onClick={onRefreshPreview}
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
        {!isDiceware && (
          <div className="space-y-3">
            {/* Password Length Slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="basic-password-length" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('items.passwordLength')}
                </label>
                <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">
                  {settings.Length}
                </span>
              </div>
              <input
                id="basic-password-length"
                type="range"
                min={SLIDER_MIN}
                max={SLIDER_MAX}
                step="0.1"
                value={lengthToSlider(settings.Length)}
                onChange={(e) => onSettingChange('Length', sliderToLength(parseFloat(e.target.value)))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Lowercase Toggle */}
              <button
                type="button"
                onClick={() => onSettingChange('UseLowercase', !settings.UseLowercase)}
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
                onClick={() => onSettingChange('UseUppercase', !settings.UseUppercase)}
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
                onClick={() => onSettingChange('UseNumbers', !settings.UseNumbers)}
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
                onClick={() => onSettingChange('UseSpecialChars', !settings.UseSpecialChars)}
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
                onChange={(e) => onSettingChange('UseNonAmbiguousChars', e.target.checked)}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600"
              />
              <label htmlFor="use-non-ambiguous" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                {t('items.avoidAmbiguousChars')}
              </label>
            </div>
          </div>
        )}

        {/* Diceware mode: passphrase options */}
        {isDiceware && (
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
                onChange={(e) => onSettingChange('WordCount', parseInt(e.target.value, 10))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
              />
            </div>

            {/* Option buttons */}
            <div className="grid grid-cols-3 gap-2">
              {/* Capitalization */}
              <button
                type="button"
                onClick={() => onSettingChange('Capitalization', cycle(CAPITALIZATION_OPTIONS, settings.Capitalization ?? 'Lowercase'))}
                className={optionButtonClass((settings.Capitalization ?? 'Lowercase') !== 'Lowercase')}
                title={`${optionLabel('Capitalization', settings.Capitalization ?? 'Lowercase')}`}
              >
                <span className="font-mono text-base">{capitalizationGlyph(settings.Capitalization ?? 'Lowercase')}</span>
              </button>

              {/* Separator */}
              <button
                type="button"
                onClick={() => onSettingChange('Separator', cycle(SEPARATOR_OPTIONS, settings.Separator ?? 'Dash'))}
                className={optionButtonClass((settings.Separator ?? 'Dash') !== 'Dash')}
                title={`${t('items.separator')}: ${optionLabel('Separator', settings.Separator ?? 'Dash')}`}
              >
                <span className="font-mono text-base">{separatorGlyph(settings.Separator ?? 'Dash')}</span>
              </button>

              {/* Salt */}
              <button
                type="button"
                onClick={() => onSettingChange('Salt', cycle(SALT_OPTIONS, settings.Salt ?? 'None'))}
                className={optionButtonClass((settings.Salt ?? 'None') !== 'None')}
                title={`${t('items.salt')}: ${optionLabel('Salt', settings.Salt ?? 'None')}`}
              >
                <span className="font-mono text-base">{saltGlyph(settings.Salt ?? 'None')}</span>
              </button>
            </div>

            {/* Passphrase language */}
            {showLanguagePicker && (
              <div>
                <label htmlFor="diceware-language" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('items.passphraseLanguage')}
                </label>
                <select
                  id="diceware-language"
                  value={currentLanguage}
                  onChange={(e) => onSettingChange('Language', e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-primary-500 focus:border-primary-500"
                >
                  {dicewareLanguages.map((code) => {
                    const { flag, label } = getLanguageInfo(code);
                    return (
                      <option key={code} value={code}>
                        {flag} {label}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default PasswordConfigForm;
