import { ApiRequestError } from '@aliasvault/client/api/errors/ApiRequestError';

import type { TFunction } from 'i18next';

/**
 * The message for a failed API call: the translated API error code when the server sent one, else the fallback.
 * @param error - the thrown error
 * @param t - the translation function
 * @param fallback - the message when no known code is present
 */
export function apiErrorMessage(error: unknown, t: TFunction, fallback: string): string {
  if (error instanceof ApiRequestError && error.apiErrorCode) {
    const key = `apiErrors.${error.apiErrorCode}`;
    const translated = t(key);
    return translated === key ? fallback : translated;
  }
  return fallback;
}
