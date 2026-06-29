import { type Browser } from '@wxt-dev/browser';

import { handleGetPasswordSettings } from '@/entrypoints/background/VaultMessageHandler';

import { POPUP_TYPES, type PopupType, isPopupType } from '@/utils/autofill/PopupTypes';
import type { PasswordSettings } from '@/utils/dist/core/models/vault';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import * as RustCore from '@/utils/RustCore';

import { t } from '@/i18n/StandaloneI18n';

import { browser } from "#imports";

const MENU_ID_PREFIX = 'aliasvault-activate-form-';

/** Context-menu item id for a popup type. */
function menuIdForPopupType(type: PopupType): string {
  return `${MENU_ID_PREFIX}${type}`;
}

/** Reverse lookup: context-menu item id -> popup type. */
function popupTypeForMenuId(menuId: string | number): PopupType | undefined {
  if (typeof menuId !== 'string' || !menuId.startsWith(MENU_ID_PREFIX)) {
    return undefined;
  }
  const candidate = menuId.slice(MENU_ID_PREFIX.length);
  return isPopupType(candidate) ? candidate : undefined;
}

/*
 * Register the click listener once at module load (top-level scope).
 */
browser.contextMenus.onClicked.addListener((info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab) =>
  handleContextMenuClick(info, tab)
);

/**
 * Create a context menu item.
 */
function createContextMenu(properties: Browser.contextMenus.CreateProperties) : Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const result = browser.contextMenus.create(properties, () => {
        const lastError = browser.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message ?? 'contextMenus.create failed'));
        } else {
          resolve();
        }
      });
      // Some polyfill versions return a thenable; if so, attach handlers as a fallback.
      if (result && typeof (result as unknown as Promise<unknown>).then === 'function') {
        (result as unknown as Promise<unknown>).then(() => resolve(), reject);
      }
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Setup the context menus.
 */
export async function setupContextMenus() : Promise<void> {
  try {
    await browser.contextMenus.removeAll();
  } catch (error) {
    console.error('Failed to remove existing context menus:', error);
  }

  const popupEntries = Object.entries(POPUP_TYPES) as [PopupType, typeof POPUP_TYPES[PopupType]][];
  const [popupTitles, generatePasswordTitle] = await Promise.all([
    Promise.all(popupEntries.map(([, config]) => t(config.titleKey))),
    t('content.generateRandomPassword'),
  ]);

  try {
    // Root must exist before its children
    await createContextMenu({
      id: "aliasvault-root",
      title: "AliasVault",
      contexts: ["all"]
    });

    await Promise.all([
      ...popupEntries.map(([type], i) => createContextMenu({
        id: menuIdForPopupType(type),
        parentId: "aliasvault-root",
        title: popupTitles[i],
        contexts: ["editable"],
      })),
      createContextMenu({
        id: "aliasvault-separator",
        parentId: "aliasvault-root",
        type: "separator",
        contexts: ["editable"],
      }),
      createContextMenu({
        id: "aliasvault-generate-password",
        parentId: "aliasvault-root",
        title: generatePasswordTitle,
        contexts: ["all"]
      }),
    ]);
  } catch (error) {
    console.error('Failed to create context menus:', error);
  }
}

/**
 * Get the user's saved password settings when the vault is unlocked, otherwise fall back to
 * defaults so password generation still works while locked.
 */
async function getPasswordSettingsOrDefault(): Promise<PasswordSettings> {
  const defaults: PasswordSettings = {
    Length: 18,
    UseLowercase: true,
    UseUppercase: true,
    UseNumbers: true,
    UseSpecialChars: true,
    UseNonAmbiguousChars: false
  };

  try {
    const response = await handleGetPasswordSettings();
    return response.success && response.settings ? response.settings : defaults;
  } catch {
    return defaults;
  }
}

/**
 * Handle context menu clicks.
 */
export function handleContextMenuClick(info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab) : void {
  if (info.menuItemId === "aliasvault-generate-password") {
    /*
     * Generate a password and copy it to the clipboard of the active tab. Use the user's saved 
     * settings when the vault is unlocked; otherwise fall back to defaults.
     */
    if (tab?.id) {
      const tabId = tab.id;
      void (async (): Promise<void> => {
        const settings = await getPasswordSettingsOrDefault();
        const password = await RustCore.generatePassword(settings);
        const message = await t('content.passwordCopiedToClipboard');
        browser.scripting.executeScript({
          target: { tabId },
          func: copyPasswordToClipboard,
          args: [message, password]
        });
      })();
    }
  } else if (tab?.id) {
    const popupType = popupTypeForMenuId(info.menuItemId);
    if (!popupType) {
      return;
    }

    // First get the active element's identifier
    browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: getActiveElementIdentifier,
    }, (results) => {
      const elementIdentifier = results[0]?.result;
      if (elementIdentifier) {
        // Send message to content script with proper tab targeting
        sendMessage('OPEN_AUTOFILL_POPUP', { elementIdentifier, popupType }, tab.id);
      }
    });
  }
}

/**
 * Copy provided password to clipboard.
 */
function copyPasswordToClipboard(message: string, generatedPassword: string) : void {
  navigator.clipboard.writeText(generatedPassword).then(() => {
    showToast(message);
  });

  /**
   * Show a toast notification.
   */
  function showToast(message: string) : void {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px;
        background: #4CAF50;
        color: white;
        border-radius: 4px;
        z-index: 9999;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }
}

/**
 * Activate AliasVault for the active input element.
 */
function getActiveElementIdentifier() : string {
  const target = document.activeElement;
  if (target instanceof HTMLInputElement) {
    return target.id || target.name || '';
  }
  return '';
}