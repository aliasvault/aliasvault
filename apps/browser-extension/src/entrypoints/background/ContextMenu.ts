import { type Browser } from '@wxt-dev/browser';
import { sendMessage } from 'webext-bridge/background';

import { PasswordGenerator } from '@/utils/dist/core/password-generator';

import { t } from '@/i18n/StandaloneI18n';

import { browser } from "#imports";

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

  const [activateFormTitle, generatePasswordTitle] = await Promise.all([
    t('content.autofillWithAliasVault'),
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
      createContextMenu({
        id: "aliasvault-activate-form",
        parentId: "aliasvault-root",
        title: activateFormTitle,
        contexts: ["editable"],
      }),
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
 * Handle context menu clicks.
 */
export function handleContextMenuClick(info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab) : void {
  if (info.menuItemId === "aliasvault-generate-password") {
    // Initialize password generator
    const passwordGenerator = new PasswordGenerator();
    const password = passwordGenerator.generateRandomPassword();

    // Use browser.scripting to write password to clipboard from active tab
    if (tab?.id) {
      // Get confirm text translation.
      t('content.passwordCopiedToClipboard').then((message) => {
        browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: copyPasswordToClipboard,
          args: [message, password]
        });
      });
    }
  } else if (info.menuItemId === "aliasvault-activate-form" && tab?.id) {
    // First get the active element's identifier
    browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: getActiveElementIdentifier,
    }, (results) => {
      const elementIdentifier = results[0]?.result;
      if (elementIdentifier) {
        // Send message to content script with proper tab targeting
        sendMessage('OPEN_AUTOFILL_POPUP', { elementIdentifier }, `content-script@${tab.id}`);
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