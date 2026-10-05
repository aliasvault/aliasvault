/**
 * Serves the local preferences content scripts need. Content scripts have no `storage.local` access (see
 * restrictContentScriptStorage), so they read and change these preferences through the background.
 */

import { handleCheckAuthStatus } from '@/entrypoints/background/VaultMessageHandler';

import { logFailure } from '@/utils/Diagnostics';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import type { ContentSettings } from '@/utils/types/messaging/ContentSettings';

import { getCurrentLanguage } from '@/i18n/StandaloneI18n';

import { browser } from '#imports';

/** How long "dismiss" hides the vault locked popup while logged in, and while logged out. */
const VAULT_LOCKED_DISMISS_LOGGED_IN_MS = 4 * 60 * 60 * 1000;
const VAULT_LOCKED_DISMISS_LOGGED_OUT_MS = 3 * 24 * 60 * 60 * 1000;

/** How long "disable for now" turns off the autofill popup on a site. */
const TEMPORARY_SITE_DISABLE_MS = 60 * 60 * 1000;

/**
 * Block content scripts from `storage.local` (Chrome 140+). The level persists across restarts, so this only
 * needs to succeed once; browsers without support (Firefox, Safari, older Chrome) keep their default.
 */
export async function restrictContentScriptStorage(): Promise<void> {
  const local = browser.storage.local as { setAccessLevel?: (options: { accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void> };
  if (typeof local.setAccessLevel !== 'function') {
    return;
  }
  try {
    await local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {
    // Not supported for the local area in this browser version.
  }
}

/**
 * The preferences the content script reads, with the site checks applied to the sender's host.
 * @param hostname - Host of the sending frame, or null when unknown.
 */
export async function handleGetContentSettings(hostname: string | null): Promise<ContentSettings> {
  const [credentialPopupEnabled, totpPopupEnabled, autoCopyTotpOnAutofill, matchingMode, vaultLockedDismissUntil, disabledSites, temporaryDisabledSites] = await Promise.all([
    LocalPreferencesService.getGlobalAutofillPopupEnabled(),
    LocalPreferencesService.getTotpAutofillEnabled(),
    LocalPreferencesService.getAutoCopyTotpOnAutofill(),
    LocalPreferencesService.getAutofillMatchingMode(),
    LocalPreferencesService.getVaultLockedDismissUntil(),
    LocalPreferencesService.getDisabledSites(),
    LocalPreferencesService.getTemporaryDisabledSites(),
  ]);

  const temporaryDisabledUntil = hostname ? temporaryDisabledSites[hostname] : undefined;
  const siteAutofillAllowed = hostname === null || (!disabledSites.includes(hostname) && !(temporaryDisabledUntil && Date.now() < temporaryDisabledUntil));

  return { credentialPopupEnabled, totpPopupEnabled, autoCopyTotpOnAutofill, matchingMode, vaultLockedDismissUntil, siteAutofillAllowed };
}

/**
 * Turn off the autofill popup on the sender's host, for an hour or permanently.
 * @param hostname - Host of the sending frame.
 * @param temporary - True for an hour, false for permanently.
 */
export async function handleDisableAutofillForSite(hostname: string | null, temporary: boolean): Promise<void> {
  if (!hostname) {
    return;
  }

  if (temporary) {
    const temporaryDisabledSites = await LocalPreferencesService.getTemporaryDisabledSites();
    temporaryDisabledSites[hostname] = Date.now() + TEMPORARY_SITE_DISABLE_MS;
    await LocalPreferencesService.setTemporaryDisabledSites(temporaryDisabledSites);
    return;
  }

  const disabledSites = await LocalPreferencesService.getDisabledSites();
  if (!disabledSites.includes(hostname)) {
    disabledSites.push(hostname);
    await LocalPreferencesService.setDisabledSites(disabledSites);
  }
}

/**
 * Hide the vault locked popup for 4 hours when logged in, or 3 days when logged out.
 */
export async function handleDismissVaultLockedPopup(): Promise<void> {
  const { isLoggedIn } = await handleCheckAuthStatus();
  await LocalPreferencesService.setVaultLockedDismissUntil(Date.now() + (isLoggedIn ? VAULT_LOCKED_DISMISS_LOGGED_IN_MS : VAULT_LOCKED_DISMISS_LOGGED_OUT_MS));
}

/**
 * Whether save prompts are turned off for a domain.
 * @param domain - The login's domain.
 */
export async function handleIsLoginSaveBlocked(domain: string): Promise<boolean> {
  try {
    return (await LocalPreferencesService.getLoginSaveBlockedDomains()).includes(domain);
  } catch {
    return false;
  }
}

/**
 * Turn off save prompts for a domain.
 * @param domain - The login's domain.
 */
export async function handleBlockLoginSaveForDomain(domain: string): Promise<void> {
  try {
    const blockedDomains = await LocalPreferencesService.getLoginSaveBlockedDomains();
    if (!blockedDomains.includes(domain)) {
      blockedDomains.push(domain);
      await LocalPreferencesService.setLoginSaveBlockedDomains(blockedDomains);
    }
  } catch (error) {
    logFailure('[AliasVault] Error saving blocked domain', error);
  }
}

/**
 * The UI language, for content script translations.
 */
export function handleGetLanguage(): Promise<string> {
  return getCurrentLanguage();
}
