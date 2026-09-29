import { apiErrorKey } from '../api/errors/ApiErrorMessage';
import { AppErrorCode, formatErrorWithCode, getAppErrorCode, getErrorTranslationKey } from '../api/errors/AppErrorCodes';
import { ClientUpgradeRequiredError } from '../api/errors/ClientUpgradeRequiredError';
import { ServerUpdateRequiredError } from '../api/errors/ServerUpdateRequiredError';

import { VaultKeyService } from './VaultKeyService';

import type { TranslationKey } from '@aliasvault/i18n';

/**
 * A failure as the UI shows it: the translation key of its message, and the error code to show next to it.
 */
export type ErrorMessage = {
  key: TranslationKey;
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
 * How {@link describeAuthError} reads the failure.
 */
export type AuthErrorOptions = {
  /** The message for a failure without a code, by default the "could not reach the server" message. */
  fallback?: TranslationKey;
  /** Take a failure without any code as a wrong password (or PIN): a local unlock has no other way to fail uncoded. */
  uncodedIsWrongPassword?: boolean;
};

/**
 * The message for a failed login or unlock, the same on every client.
 * @param err - the thrown error
 * @param options - how to read the failure
 */
export async function describeAuthError(err: unknown, options: AuthErrorOptions = {}): Promise<AuthErrorMessage> {
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

  const code = getAppErrorCode(err);
  if (await VaultKeyService.isWrongUnlockKey(code)) {
    return { key: 'common.errors.wrongPassword', wrongPassword: true };
  }
  if (code) {
    return { key: getErrorTranslationKey(code), code, wrongPassword: false };
  }
  if (options.uncodedIsWrongPassword) {
    return { key: 'common.errors.wrongPassword', wrongPassword: true };
  }
  return { key: options.fallback ?? 'common.errors.serverError', wrongPassword: false };
}

/**
 * The text of an error message, with its code appended when it has one.
 * @param message - the error message
 * @param t - the renderer's translation function
 */
export function formatErrorMessage(message: ErrorMessage, t: (key: string) => string): string {
  return message.code ? formatErrorWithCode(t(message.key), message.code) : t(message.key);
}
