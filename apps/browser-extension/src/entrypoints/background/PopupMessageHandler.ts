/* eslint-disable @typescript-eslint/no-explicit-any */
import { setupContextMenus } from '@/entrypoints/background/ContextMenu';

import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { ServiceDetectionUtility } from '@/utils/serviceDetection/ServiceDetectionUtility';
import { BoolResponse } from '@/utils/types/messaging/BoolResponse';

import { browser } from '#imports';

/**
 * Handle opening the popup.
 */
export function handleOpenPopup() : Promise<BoolResponse> {
  return (async () : Promise<BoolResponse> => {
    browser.windows.create({
      url: browser.runtime.getURL('/popup.html?mode=inline_unlock&expanded=true'),
      type: 'popup',
      width: 400,
      height: 600,
      focused: true
    });
    return { success: true };
  })();
}

/**
 * Handle opening the popup with an item.
 */
export function handlePopupWithItem(message: any) : Promise<BoolResponse> {
  return (async () : Promise<BoolResponse> => {
    browser.windows.create({
      url: browser.runtime.getURL(`/popup.html?expanded=true#/items/${message.itemId}`),
      type: 'popup',
      width: 400,
      height: 600,
      focused: true
    });
    return { success: true };
  })();
}

/**
 * Handle opening the popup on create item page with a prefilled item title.
 */
export function handleOpenPopupCreateCredential(message: any, sender?: any) : Promise<BoolResponse> {
  return (async () : Promise<BoolResponse> => {
    const itemTitle = message.itemTitle || '';
    const currentUrl = message.currentUrl || '';
    const sourceTabId = sender?.tab?.id;
    const elementIdentifier = message.elementIdentifier;

    // Derive the service URL (origin only) from the page URL passed by the content script.
    const serviceUrl = currentUrl ? ServiceDetectionUtility.sanitizeUrl(currentUrl) : '';

    // Set a localStorage flag to skip restoring previously persisted form values as we want to start fresh with this explicit create item request.
    await LocalPreferencesService.setSkipFormRestore(true);

    const hashParams = new URLSearchParams();
    if (itemTitle) {
      hashParams.set('itemTitle', itemTitle);
    }
    if (serviceUrl) {
      hashParams.set('serviceUrl', serviceUrl);
    }
    if (currentUrl) {
      hashParams.set('currentUrl', currentUrl);
    }
    // Default to Login type for quick create from content script
    hashParams.set('type', 'Login');

    if (sourceTabId !== undefined && sourceTabId !== null) {
      hashParams.set('sourceTabId', String(sourceTabId));
    }
    if (elementIdentifier) {
      hashParams.set('elementIdentifier', String(elementIdentifier));
    }

    const createOptions: Parameters<typeof browser.windows.create>[0] = {
      url: browser.runtime.getURL(`/popup.html?expanded=true#/items/add?${hashParams.toString()}`),
      type: 'popup',
      width: 400,
      height: 600,
      focused: true
    };

    /*
     * Position the window near where the user clicked (passed by the content script, already clamped
     * to the screen). When absent, the browser picks a default position.
     */
    if (typeof message.left === 'number' && typeof message.top === 'number') {
      createOptions.left = Math.round(message.left);
      createOptions.top = Math.round(message.top);
    }

    browser.windows.create(createOptions);
    return { success: true };
  })();
}

/**
 * Handle toggling the context menu.
 */
export function handleToggleContextMenu(message: any) : Promise<BoolResponse> {
  return (async () : Promise<BoolResponse> => {
    if (!message.enabled) {
      browser.contextMenus.removeAll();
    } else {
      await setupContextMenus();
    }
    return { success: true };
  })();
}
