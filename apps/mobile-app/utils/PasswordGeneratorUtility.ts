/**
 * Typed wrapper around the native Rust core for password/passphrase generation.
 */
import NativeVaultManager from '@/specs/NativeVaultManager';
import { resolveDefaultLanguage } from '@/utils/dist/core/models/defaults';
import type { PasswordSettings } from '@/utils/dist/core/models/vault';

/**
 * Generate a password or passphrase from the given settings.
 * 
 * @param settings The password settings.
 * @param seed Optional 64-character hex RNG seed for deterministic generation.
 * @returns The generated password/passphrase.
 */
export async function generatePassword(settings: PasswordSettings, seed?: string): Promise<string> {
  const effective = await applyEffectiveDicewareLanguage(settings);
  const payload = seed ? { ...effective, Seed: seed } : effective;
  return NativeVaultManager.generatePassword(JSON.stringify(payload));
}

/**
 * Resolve the effective Diceware passphrase language when none is explicitly chosen.
 *
 * @param settings The password settings.
 * @returns The settings with a concrete Diceware language when one needed resolving.
 */
async function applyEffectiveDicewareLanguage(settings: PasswordSettings): Promise<PasswordSettings> {
  if (settings.Type !== 'diceware' || (settings.Language && settings.Language.trim().length > 0)) {
    return settings;
  }
  const codes = await getDicewareLanguages();
  const { default: i18n } = await import('@/i18n');
  return { ...settings, Language: resolveDefaultLanguage(i18n.language, codes) };
}

/**
 * Get the list of bundled Diceware wordlist language ISO codes (first is the default, English/'en').
 * @returns The available language codes.
 */
export async function getDicewareLanguages(): Promise<string[]> {
  const languages = await NativeVaultManager.getDicewareLanguages();
  return languages.length > 0 ? languages : ['en'];
}

/**
 * Generate a random 32-byte seed as a 64-character hex string, suitable for the `seed` argument.
 * @returns A 64-character hex string.
 */
export function generateSeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
