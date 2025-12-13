import { type Browser } from '@wxt-dev/browser';
import { sendMessage } from 'webext-bridge/background';

import { PasswordGenerator } from '@/utils/dist/core/password-generator';

import { t } from '@/i18n/StandaloneI18n';

import { browser } from "#imports";

/**
 * Setup the context menus.
 */
export async function setupContextMenus() : Promise<void> {
  // Create root menu
  browser.contextMenus.create({
    id: "aliasvault-root",
    title: "AliasVault",
    contexts: ["all"]
  });

  // Add fill option first (only for editable fields)
  browser.contextMenus.create({
    id: "aliasvault-activate-form",
    parentId: "aliasvault-root",
    title: await t('content.autofillWithAliasVault'),
    contexts: ["editable"],
  });

  // Add separator (only for editable fields)
  browser.contextMenus.create({
    id: "aliasvault-separator",
    parentId: "aliasvault-root",
    type: "separator",
    contexts: ["editable"],
  });

  // Add password generator option
  browser.contextMenus.create({
    id: "aliasvault-generate-password",
    parentId: "aliasvault-root",
    title: await t('content.generateRandomPassword'),
    contexts: ["all"]
  });

  browser.contextMenus.onClicked.addListener((info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab) =>
    handleContextMenuClick(info, tab)
  );
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