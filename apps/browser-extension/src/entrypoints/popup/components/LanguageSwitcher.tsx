import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { AVAILABLE_LANGUAGES, getLanguageConfig, ILanguageConfig } from '../../../i18n/config';

import { storage } from '#imports';
import { StorageKeys } from '@/utils/constants/storageKeys';

type LanguageSwitcherProps = {
  variant?: 'dropdown' | 'buttons';
  size?: 'sm' | 'md';
};

/**
 * Language switcher component that allows users to switch between supported languages
 * @param props - Component props including variant and size
 * @returns JSX element for the language switcher
 */
const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  variant = 'dropdown',
  size = 'md'
}): React.JSX.Element => {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLanguage = getLanguageConfig(i18n.language) || AVAILABLE_LANGUAGES[0];

  // Close dropdown when clicking outside
  useEffect((): (() => void) => {
    /**
     * Handle clicks outside the dropdown to close it
     * @param event - Mouse event
     */
    const handleClickOutside = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  /**
   * Change the application language
   * @param lng - Language code to switch to
   */
  const changeLanguage = async (lng: string): Promise<void> => {
    await i18n.changeLanguage(lng);
    await storage.setItem(StorageKeys.LANGUAGE, lng);

    setIsOpen(false);

    // Force immediate re-render by dispatching the event that react-i18next listens to
    i18n.emit('languageChanged', lng);
  };

  if (variant === 'buttons') {
    return (
      <div className="flex space-x-2">
        {AVAILABLE_LANGUAGES.map((lang: ILanguageConfig) => (
          <button
            key={lang.code}
            onClick={() => changeLanguage(lang.code)}
            className={`flex items-center space-x-1 px-2 py-1 text-xs rounded transition-colors ${
              i18n.language === lang.code
                ? 'bg-primary-500 text-white'
                : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-500'
            }`}
            title={lang.nativeName}
          >
            <span className="text-sm">{lang.flag}</span>
            <span>{lang.code.toUpperCase()}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors ${
          size === 'sm' ? 'text-sm' : 'text-base'
        }`}
      >
        <div className="flex items-center space-x-2">
          <span className="text-lg">{currentLanguage.flag}</span>
          <span>{currentLanguage.nativeName}</span>
        </div>
        <svg
          className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-50">
          {AVAILABLE_LANGUAGES.map((lang: ILanguageConfig) => (
            <button
              key={lang.code}
              onClick={() => changeLanguage(lang.code)}
              className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                size === 'sm' ? 'text-sm' : 'text-base'
              }`}
            >
              <div className="flex items-center space-x-2">
                <span className="text-lg">{lang.flag}</span>
                <span className="text-gray-700 dark:text-gray-200">{lang.nativeName}</span>
              </div>
              {i18n.language === lang.code && (
                <svg className="w-4 h-4 text-primary-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default LanguageSwitcher;