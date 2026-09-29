import { englishTranslations, getTranslation, type TranslationKey } from '@aliasvault/i18n';

import { apiErrorCodeOf } from './ApiRequestError';

/**
 * The translation key of the API error code a failed request carries, or null when it carries none this client has words for.
 * @param error - the thrown error
 */
export function apiErrorKey(error: unknown): TranslationKey | null {
  const code = apiErrorCodeOf(error);
  const key = code ? `apiErrors.${code}` : null;
  return key && getTranslation(englishTranslations, key) !== undefined ? key as TranslationKey : null;
}

/**
 * The message for a failed API call: the translated API error code when the server sent one, else the fallback.
 * @param error - the thrown error
 * @param t - the renderer's translation function
 * @param fallback - the message when no known code is present
 */
export function apiErrorMessage(error: unknown, t: (key: string) => string, fallback: string): string {
  const key = apiErrorKey(error);
  return key ? t(key) : fallback;
}
