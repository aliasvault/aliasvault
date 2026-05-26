import type { TFunction } from 'i18next';
import { useTranslation as useReactI18nextTranslation } from 'react-i18next';

/**
 * Custom hook for translation functionality
 * @returns Translation utilities
 */
export const useTranslation = (): {
  t: TFunction;
  currentLanguage: string;
} => {
  const { t, i18n } = useReactI18nextTranslation();

  return {
    t,
    currentLanguage: i18n.language,
  };
};