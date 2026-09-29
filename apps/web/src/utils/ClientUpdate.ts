import i18n from '@/i18n/i18n';

import type { TranslationKey } from '@aliasvault/i18n';

/*
 * The messages that ask the user to update AliasVault, shown as a blocking page with an update button.
 */
const CLIENT_UPDATE_KEYS: TranslationKey[] = ['common.errors.clientNotSupported', 'common.errors.clientOutdated'];

/**
 * Whether a message asks the user to update AliasVault.
 * @param message - the translated message, possibly followed by an error code
 */
export function asksForClientUpdate(message: string): boolean {
  return CLIENT_UPDATE_KEYS.some(key => message.startsWith(i18n.t(key)));
}

/**
 * Load the latest version of the web app.
 */
export function updateApp(): void {
  window.location.reload();
}
