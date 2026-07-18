import { useState, useEffect, useCallback, useRef } from 'react';

import type { PasswordSettings } from '@/utils/dist/core/models/vault';
import * as RustCore from '@/utils/RustCore';

/**
 * Value returned by {@link usePasswordConfig}.
 */
export interface IPasswordConfig {
  /** The current password settings being edited. */
  settings: PasswordSettings;
  /** The live preview password/passphrase for the current settings. */
  previewPassword: string;
  /** The Diceware wordlist language codes available from the core. */
  dicewareLanguages: string[];
  /** Update a single setting, regenerating the preview with the stable seed. */
  handleSettingChange: (key: keyof PasswordSettings, value: boolean | number | string) => void;
  /** Draw a fresh seed and regenerate the preview (genuinely new password). */
  handleRefreshPreview: () => void;
  /** Re-initialize from the given settings with a fresh seed (e.g. when a dialog reopens). */
  reset: (settings: PasswordSettings) => void;
}

/**
 * Shared state + preview logic for the password generator UI.
 * 
 * @param initialSettings - The settings to start from.
 * @param onSettingsChange - Optional callback fired with the full settings on every change.
 * @returns The password config state and handlers.
 */
export function usePasswordConfig(
  initialSettings: PasswordSettings,
  onSettingsChange?: (settings: PasswordSettings) => void
): IPasswordConfig {
  const [settings, setSettings] = useState<PasswordSettings>(initialSettings);
  const [previewPassword, setPreviewPassword] = useState<string>('');
  const [dicewareLanguages, setDicewareLanguages] = useState<string[]>([]);
  const seedRef = useRef<string>('');

  const generatePreview = useCallback(async (currentSettings: PasswordSettings, currentSeed: string): Promise<void> => {
    try {
      const password = await RustCore.generatePassword(currentSettings, currentSeed);
      setPreviewPassword(password);
    } catch (error) {
      console.error('Error generating preview password:', error);
      setPreviewPassword('');
    }
  }, []);

  // Initialize the seed + preview once on mount.
  useEffect(() => {
    seedRef.current = RustCore.generateSeed();
    void generatePreview(initialSettings, seedRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the available Diceware languages once.
  useEffect(() => {
    let cancelled = false;
    void RustCore.getDicewareLanguages().then((languages) => {
      if (!cancelled) {
        setDicewareLanguages(languages);
      }
    });
    return (): void => {
      cancelled = true;
    };
  }, []);

  const handleSettingChange = useCallback((key: keyof PasswordSettings, value: boolean | number | string) => {
    setSettings((prev): PasswordSettings => {
      const newSettings = { ...prev, [key]: value };
      // Reuse the stable seed so only the changed option affects the preview.
      void generatePreview(newSettings, seedRef.current);
      onSettingsChange?.(newSettings);
      return newSettings;
    });
  }, [generatePreview, onSettingsChange]);

  const handleRefreshPreview = useCallback(() => {
    seedRef.current = RustCore.generateSeed();
    setSettings((prev): PasswordSettings => {
      void generatePreview(prev, seedRef.current);
      return prev;
    });
  }, [generatePreview]);

  const reset = useCallback((newSettings: PasswordSettings) => {
    seedRef.current = RustCore.generateSeed();
    setSettings(newSettings);
    void generatePreview(newSettings, seedRef.current);
  }, [generatePreview]);

  return {
    settings,
    previewPassword,
    dicewareLanguages,
    handleSettingChange,
    handleRefreshPreview,
    reset
  };
}
