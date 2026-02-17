/* eslint-disable @typescript-eslint/no-explicit-any */
import { setupContextMenus } from '@/entrypoints/background/ContextMenu';

import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
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
 * Handle opening the popup on create item page with prefilled service name.
 */
export function handleOpenPopupCreateCredential(message: any) : Promise<BoolResponse> {
  return (async () : Promise<BoolResponse> => {
    const serviceName = encodeURIComponent(message.serviceName || '');

    // Use the URL passed from the content script (current page URL)
    let serviceUrl = '';
    if (message.currentUrl) {
      try {
        const url = new URL(message.currentUrl);
        // Only include http/https URLs
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          serviceUrl = encodeURIComponent(url.origin + url.pathname);
        }
      } catch (error) {
        console.error('Error parsing current URL:', error);
      }
    }

    // Set a localStorage flag to skip restoring previously persisted form values as we want to start fresh with this explicit create item request.
    await LocalPreferencesService.setSkipFormRestore(true);

    const urlParams = new URLSearchParams();
    urlParams.set('expanded', 'true');
    if (serviceName) {
      urlParams.set('name', serviceName);
    }
    if (serviceUrl) {
      urlParams.set('serviceUrl', serviceUrl);
    }
    if (message.currentUrl) {
      urlParams.set('currentUrl', message.currentUrl);
    }
    // Default to Login type for quick create from content script
    urlParams.set('type', 'Login');

    browser.windows.create({
      url: browser.runtime.getURL(`/popup.html?${urlParams.toString()}#/items/add`),
      type: 'popup',
      width: 400,
      height: 600,
      focused: true
    });
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
