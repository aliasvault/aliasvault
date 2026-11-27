import { apiErrorKey } from '../api/errors/ApiErrorMessage';
import { ApiRequestError } from '../api/errors/ApiRequestError';
import { AppErrorCode, formatErrorWithCode, getAppErrorCode, getErrorTranslationKey } from '../api/errors/AppErrorCodes';
import { ClientUpgradeRequiredError } from '../api/errors/ClientUpgradeRequiredError';
import { NetworkError } from '../api/errors/NetworkError';
import { ServerUpdateRequiredError } from '../api/errors/ServerUpdateRequiredError';
import { AppInfo } from '../platform/AppInfo';

import { VaultKeyService } from './VaultKeyService';

import type { TranslationKey } from '@aliasvault/i18n';

/**
 * A failure as the UI shows it: the translation key of its message, and the error code to show next to it.
 */
export type ErrorMessage = {
  key: TranslationKey;
  params?: Record<string, string>;
  code?: AppErrorCode;
};

/**
 * A failed login or unlock as the UI shows it.
 */
export type AuthErrorMessage = ErrorMessage & {
  /** The entered password (or PIN) was wrong; hosts that count failed attempts count this one. */
  wrongPassword: boolean;
};

/**
 * The message for a failed login or unlock, the same on every client. A failure without an error code is unexpected (E-001).
 * @param err - the thrown error
 */
export async function describeAuthError(err: unknown): Promise<AuthErrorMessage> {
  if (err instanceof ClientUpgradeRequiredError) {
    return { key: 'common.errors.clientNotSupported', wrongPassword: false };
  }
  if (err instanceof ServerUpdateRequiredError) {
    return { key: 'common.errors.serverOutdated', wrongPassword: false };
  }

  // The server refused the login with a coded reason (wrong password, account locked).
  const apiKey = apiErrorKey(err);
  if (apiKey) {
    return { key: apiKey, wrongPassword: false };
  }

  // A self-hosted server that cannot be reached, or answers with an error page, is named so the user can test its URL.
  if ((err instanceof NetworkError || err instanceof ApiRequestError) && err.code && err.apiUrl && err.apiUrl !== AppInfo.DEFAULT_API_URL) {
    return { key: 'auth.errors.selfHostedServerUnreachable', params: { apiUrl: err.apiUrl }, code: err.code, wrongPassword: false };
  }

  const code = getAppErrorCode(err) ?? AppErrorCode.UNKNOWN_ERROR;
  if (await VaultKeyService.isWrongUnlockKey(code)) {
    return { key: 'common.errors.wrongPassword', wrongPassword: true };
  }
  return { key: getErrorTranslationKey(code), code, wrongPassword: false };
}

/**
 * The text of an error message, with its code appended when it has one.
 * @param message - the error message
 * @param t - the renderer's translation function
 */
export function formatErrorMessage(message: ErrorMessage, t: (key: string, params?: Record<string, string>) => string): string {
  const text = t(message.key, message.params);
  return message.code ? formatErrorWithCode(text, message.code) : text;
}
