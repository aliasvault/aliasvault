import React, { createContext, useContext, useState, useMemo, useEffect, useCallback } from 'react';
import { storage } from 'wxt/storage';

/**
 * Theme type.
 */
type Theme = 'light' | 'dark' | 'system';

/**
 * Theme preference key in storage.
 */
const THEME_PREFERENCE_KEY = 'local:theme';

/**
 * Theme context type.
 */
type ThemeContextType = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  isDarkMode: boolean;
}

/**
 * Theme context.
 */
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Theme provider
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  /**
   * Theme state that can be 'light', 'dark', or 'system'.
   */
  const [theme, setThemeState] = useState<Theme>('system');

  /**
   * Tracks whether dark mode is active (based on theme or system preference).
   */
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  useEffect(() => {
    /**
     * Load theme setting from storage.
     */
    const loadTheme = async () : Promise<void> => {
      const savedTheme = await getTheme();
      setThemeState(savedTheme);
    };
    loadTheme();
  }, []);

  /**
   * Set the theme.
   */
  const setTheme = useCallback((newTheme: Theme): void => {
    setThemeState(newTheme);
    setStoredTheme(newTheme);
  }, []);

  /**
   * Get the theme from storage.
   */
  const getTheme = async (): Promise<Theme> => {
    return (await storage.getItem(THEME_PREFERENCE_KEY) as Theme) || 'system';
  };

  /**
   * Set the theme in storage.
   */
  const setStoredTheme = async (theme: Theme): Promise<void> => {
    await storage.setItem(THEME_PREFERENCE_KEY, theme);
  };

  /**
   * Effect to apply theme to document and handle system preference changes
   */
  useEffect(() => {
    /**
     * Update the dark mode status.
     */
    const updateDarkMode = (): void => {
      if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        setIsDarkMode(prefersDark);
        document.documentElement.classList.toggle('dark', prefersDark);
      } else {
        const isDark = theme === 'dark';
        setIsDarkMode(isDark);
        document.documentElement.classList.toggle('dark', isDark);
      }
    };

    // Initial update
    updateDarkMode();

    // Listen for system preference changes if using 'system' theme
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      /**
       * Update the dark mode status when the system preference changes.
       */
      const handler = () : void => updateDarkMode();
      mediaQuery.addEventListener('change', handler);
      return () : void => mediaQuery.removeEventListener('change', handler);
    }
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      isDarkMode,
    }),
    [theme, isDarkMode, setTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

/**
 * Hook to use theme state
 */
export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};