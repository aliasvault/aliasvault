import { getLanguageInfo, MAX_WORD_COUNT, MIN_WORD_COUNT, resolveDefaultLanguage } from '@aliasvault/models/defaults';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CopyPasteFormRow from '@/components/forms/CopyPasteFormRow';
import { useDb } from '@/context/DbContext';
import { useLoading } from '@/context/LoadingContext';
import { useNotifications } from '@/context/NotificationContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { usePasswordConfig } from '@/hooks/usePasswordConfig';
import { useVaultMutate } from '@/hooks/useVaultMutate';
import { lengthToSlider, SLIDER_MAX, SLIDER_MIN, sliderToLength } from '@/utils/PasswordLengthSlider';

import type { PasswordSettings } from '@aliasvault/models/vault';

type PasswordSettingsPopupProps = {
  passwordSettings: PasswordSettings;
  /** Offer "use just once" next to the global save. */
  isTemporary: boolean;
  onSaveSettings: (settings: PasswordSettings, generatedPassword: string) => void;
  onClose: () => void;
};

const DEFAULT_CAPITALIZATION = 'Lowercase';
const DEFAULT_SEPARATOR = 'Dash';
const DEFAULT_SALT = 'None';
const CAPITALIZATION_OPTIONS = ['Lowercase', 'TitleCase', 'Uppercase'];
const SEPARATOR_OPTIONS = ['Dash', 'Space', 'Underscore', 'Dot', 'None'];
const SALT_OPTIONS = ['None', 'Prefix', 'Sprinkle', 'Suffix'];

/**
 * The next option in a cycle.
 */
const cycle = (options: string[], current: string | undefined): string => options[(options.indexOf(current ?? '') + 1) % options.length];

/**
 * Classes of a character class toggle.
 */
const toggleClasses = (enabled: boolean): string => {
  const base = 'flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition-colors';
  return enabled ? `${base} bg-primary-600 text-white hover:bg-primary-700` : `${base} bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600`;
};

/**
 * Classes of a passphrase option button.
 */
const optionClasses = (customized: boolean): string => {
  const base = 'flex items-center justify-center px-2 py-2 rounded-md transition-colors';
  return customized ? `${base} bg-primary-600 text-white hover:bg-primary-700` : `${base} bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600`;
};

/**
 * Glyph of a capitalization option.
 */
const capitalizationGlyph = (value: string | undefined): string => value === 'Uppercase' ? 'ABC' : value === 'TitleCase' ? 'Abc' : 'abc';

/**
 * Glyph of a separator option.
 */
const separatorGlyph = (value: string | undefined): string => ({ Dash: '-', Space: '␣', Underscore: '_', Dot: '.' } as Record<string, string>)[value ?? ''] ?? '∅';

/**
 * Glyph of a salt option.
 */
const saltGlyph = (value: string | undefined): string => ({ Prefix: '#ab', Sprinkle: 'a#b', Suffix: 'ab#' } as Record<string, string>)[value ?? ''] ?? 'ab';

/**
 * Popup to change the password generator settings, with a live preview.
 */
const PasswordSettingsPopup: React.FC<PasswordSettingsPopupProps> = ({ passwordSettings, isTemporary, onSaveSettings, onClose }) => {
  const { t, i18n } = useTranslation();
  const dbContext = useDb();
  const { showLoading, hideLoading } = useLoading();
  const notifications = useNotifications();
  const { executeVaultMutationAsync } = useVaultMutate();
  const { settings, previewPassword, dicewareLanguages, handleSettingChange, handleRefreshPreview } = usePasswordConfig({ ...passwordSettings });
  const [sliderValue, setSliderValue] = useState(lengthToSlider(passwordSettings.Length));
  const panelRef = useRef<HTMLDivElement>(null);
  const isDiceware = settings.Type === 'diceware';
  const tk = 'components.main.settings.passwordSettingsPopup';

  useClickOutside([panelRef], onClose, true);

  // The "auto" language shown when the user has not picked one explicitly, resolved like the Rust core does.
  const effectiveLanguage = useMemo(() => resolveDefaultLanguage(i18n.language, dicewareLanguages), [dicewareLanguages, i18n.language]);
  const selectedLanguage = settings.Language && settings.Language.length > 0 ? settings.Language : effectiveLanguage;

  /**
   * Save the settings to the vault and hand the preview password back.
   */
  const onSaveGlobal = async (): Promise<void> => {
    showLoading();
    await executeVaultMutationAsync(async () => {
      dbContext.sqliteClient?.settings.setPasswordSettings(settings);
    });
    hideLoading();
    notifications.addSuccessMessage(t(`${tk}.SettingsUpdatedMessage`), true);
    onSaveSettings(settings, previewPassword);
    onClose();
  };

  /**
   * Hand the settings and the preview password back without saving.
   */
  const onSaveTemporary = (): void => {
    onSaveSettings(settings, previewPassword);
    onClose();
  };

  useEffect(() => {
    /**
     * Enter saves, Escape closes.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'Enter') {
        if (isTemporary) {
          onSaveTemporary();
        } else {
          void onSaveGlobal();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  });

  /**
   * Classes of a generator type tab.
   */
  const tabClasses = (type: string): string => {
    const active = (settings.Type && settings.Type.length > 0 ? settings.Type : 'basic') === type;
    const base = '-mb-px flex-1 border-b-2 px-3 py-3 text-sm font-medium transition-colors';
    return active ? `${base} border-primary-600 text-primary-600 dark:border-primary-500 dark:text-primary-500` : `${base} border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200`;
  };

  return (
    <div className="modal-dialog fixed inset-0 z-50 overflow-auto bg-gray-500 bg-opacity-75 flex items-center justify-center">
      <div ref={panelRef} id="passwordSettingsModal" className="relative top-20 mx-auto p-5 pt-0 shadow-lg rounded-md bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-400 w-96 max-w-[90vw]">
        <div className="m-2">
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <button type="button" onClick={() => handleSettingChange('Type', 'basic')} className={tabClasses('basic')}>{t(`${tk}.PasswordTypeBasic`)}</button>
            <button type="button" onClick={() => handleSettingChange('Type', 'diceware')} className={tabClasses('diceware')}>{t(`${tk}.PasswordTypeDiceware`)}</button>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t(`${tk}.PreviewLabel`)}</label>
              <div className="mt-1 flex">
                <div className="flex-grow"><CopyPasteFormRow id="preview-password" value={previewPassword} /></div>
                <button type="button" className="ml-2 px-3 py-2 text-sm text-gray-500 dark:text-white bg-gray-200 hover:bg-gray-300 focus:ring-4 focus:outline-none focus:ring-gray-300 font-medium rounded-md dark:bg-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-800" onClick={handleRefreshPreview}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                  </svg>
                </button>
              </div>
            </div>

            {!isDiceware ? (
              <>
                <div>
                  <label htmlFor="password-length" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t(`${tk}.PasswordLengthLabel`, { 0: settings.Length })}</label>
                  <input type="range" id="password-length" min={SLIDER_MIN} max={SLIDER_MAX} step="0.1" className="mt-1 w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 av-range-slider" value={sliderValue} onChange={(e) => {
                    const value = Number.parseFloat(e.target.value);
                    setSliderValue(value);
                    handleSettingChange('Length', sliderToLength(value));
                  }} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={toggleClasses(settings.UseLowercase)} title={t(`${tk}.IncludeLowercaseLabel`)} onClick={() => handleSettingChange('UseLowercase', !settings.UseLowercase)}><span className="font-mono text-base">a-z</span></button>
                  <button type="button" className={toggleClasses(settings.UseUppercase)} title={t(`${tk}.IncludeUppercaseLabel`)} onClick={() => handleSettingChange('UseUppercase', !settings.UseUppercase)}><span className="font-mono text-base">A-Z</span></button>
                  <button type="button" className={toggleClasses(settings.UseNumbers)} title={t(`${tk}.IncludeNumbersLabel`)} onClick={() => handleSettingChange('UseNumbers', !settings.UseNumbers)}><span className="font-mono text-base">0-9</span></button>
                  <button type="button" className={toggleClasses(settings.UseSpecialChars)} title={t(`${tk}.IncludeSpecialCharsLabel`)} onClick={() => handleSettingChange('UseSpecialChars', !settings.UseSpecialChars)}><span className="font-mono text-base">!@#</span></button>
                </div>

                <div className="flex items-center">
                  <input id="use-non-ambiguous" type="checkbox" className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded dark:bg-gray-700 dark:border-gray-600" checked={settings.UseNonAmbiguousChars} onChange={e => handleSettingChange('UseNonAmbiguousChars', e.target.checked)} />
                  <label htmlFor="use-non-ambiguous" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">{t(`${tk}.AvoidAmbiguousCharsLabel`)}</label>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="diceware-word-count" className="text-sm font-medium text-gray-700 dark:text-gray-300">{t(`${tk}.WordCountLabel`)}</label>
                    <span className="text-sm text-gray-600 dark:text-gray-400 font-mono">{settings.WordCount}</span>
                  </div>
                  <input type="range" id="diceware-word-count" min={MIN_WORD_COUNT} max={MAX_WORD_COUNT} step="1" className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 av-range-slider" value={settings.WordCount} onChange={e => handleSettingChange('WordCount', Number.parseInt(e.target.value, 10))} />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button type="button" className={optionClasses(settings.Capitalization !== DEFAULT_CAPITALIZATION)} title={t(`${tk}.Capitalization${settings.Capitalization ?? DEFAULT_CAPITALIZATION}`)} onClick={() => handleSettingChange('Capitalization', cycle(CAPITALIZATION_OPTIONS, settings.Capitalization))}>
                    <span className="font-mono text-base">{capitalizationGlyph(settings.Capitalization)}</span>
                  </button>
                  <button type="button" className={optionClasses(settings.Separator !== DEFAULT_SEPARATOR)} title={`${t(`${tk}.SeparatorLabel`)}: ${t(`${tk}.Separator${settings.Separator ?? DEFAULT_SEPARATOR}`)}`} onClick={() => handleSettingChange('Separator', cycle(SEPARATOR_OPTIONS, settings.Separator))}>
                    <span className="font-mono text-base">{separatorGlyph(settings.Separator)}</span>
                  </button>
                  <button type="button" className={optionClasses(settings.Salt !== DEFAULT_SALT)} title={`${t(`${tk}.SaltLabel`)}: ${t(`${tk}.Salt${settings.Salt ?? DEFAULT_SALT}`)}`} onClick={() => handleSettingChange('Salt', cycle(SALT_OPTIONS, settings.Salt))}>
                    <span className="font-mono text-base">{saltGlyph(settings.Salt)}</span>
                  </button>
                </div>

                <div>
                  <label htmlFor="diceware-language" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t(`${tk}.LanguageLabel`)}</label>
                  <select id="diceware-language" className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-primary-500 focus:border-primary-500" value={selectedLanguage} onChange={e => handleSettingChange('Language', e.target.value)}>
                    {dicewareLanguages.map(language => <option key={language} value={language}>{getLanguageInfo(language).label}</option>)}
                  </select>
                </div>
              </>
            )}

            <div className="flex justify-end pt-4 gap-2">
              {isTemporary && (
                <button type="button" className="px-4 py-2 bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-white rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500" onClick={onSaveTemporary}>
                  {t(`${tk}.UseJustOnceButton`)}
                </button>
              )}
              <button type="button" id="save-button" className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-primary-700 dark:hover:bg-primary-600" onClick={() => void onSaveGlobal()}>
                {t(`${tk}.SaveGloballyButton`)}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PasswordSettingsPopup;
