import React, { createContext, useContext, useState, useMemo, useEffect, useCallback } from 'react';

import { getLocalPreference, setLocalPreference } from '@/utils/LocalPreferences';
import { LocalPreferenceKeys } from '@/utils/StorageKeys';

type ThemeContextType = {
  isDarkMode: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Whether dark mode applies: the saved choice, else the system preference.
 */
const resolveIsDark = (): boolean => {
  const saved = getLocalPreference(LocalPreferenceKeys.COLOR_THEME);
  if (saved === 'dark') {
    return true;
  }
  if (saved === 'light') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

/**
 * Theme provider: applies the `dark` class on the document and persists an explicit choice.
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(resolveIsDark);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  /**
   * Follow the system preference while the user has not made an explicit choice.
   */
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    /**
     * Re-evaluate when the system preference changes.
     */
    const handler = (): void => {
      if (!getLocalPreference(LocalPreferenceKeys.COLOR_THEME)) {
        setIsDarkMode(mediaQuery.matches);
      }
    };
    mediaQuery.addEventListener('change', handler);
    return (): void => mediaQuery.removeEventListener('change', handler);
  }, []);

  /**
   * Switch between light and dark mode and remember the choice.
   */
  const toggleTheme = useCallback((): void => {
    setIsDarkMode(current => {
      const next = !current;
      setLocalPreference(LocalPreferenceKeys.COLOR_THEME, next ? 'dark' : 'light');
      return next;
    });
  }, []);

  const value = useMemo(() => ({ isDarkMode, toggleTheme }), [isDarkMode, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

/**
 * Hook to use the theme state.
 */
export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
