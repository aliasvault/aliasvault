import { sendMessage } from 'webext-bridge/background';

import { LocalPreferencesService } from '@/utils/LocalPreferencesService';

let clipboardClearTimer: NodeJS.Timeout | null = null;
let countdownInterval: NodeJS.Timeout | null = null;
let remainingTime = 0;
let currentCountdownId = 0;
let totalCountdownTime = 0;
let countdownStartTime = 0;
let offscreenDocumentCreated = false;

/**
 * Create offscreen document if it doesn't exist.
 */
async function createOffscreenDocument(): Promise<void> {
  if (offscreenDocumentCreated) {
    return;
  }

  try {
    // Check if chrome.offscreen API is available (Chrome 109+)
    if (!chrome.offscreen) {
      console.warn('[CLIPBOARD] Offscreen API not available, falling back to direct clipboard access');
      return;
    }

    // Check if offscreen document already exists
    if (chrome.runtime.getContexts) {
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('offscreen.html')]
      });

      if (existingContexts.length > 0) {
        offscreenDocumentCreated = true;
        return;
      }
    }

    // Create offscreen document
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Clear clipboard after timeout for security'
    });

    offscreenDocumentCreated = true;
  } catch (error) {
    console.error('[CLIPBOARD] Failed to create offscreen document:', error);
    offscreenDocumentCreated = false;
  }
}

/**
 * Clear clipboard using offscreen document or fallback method.
 */
async function clearClipboardContent(): Promise<void> {
  if (import.meta.env.CHROME || import.meta.env.EDGE) {
    /*
     * Chrome and Edge use mv3 and do not have direct access to clipboard
     * so we use an offscreen document to clear the clipboard.
     */
    await createOffscreenDocument();

    // Send message to offscreen document to clear clipboard
    const response = await chrome.runtime.sendMessage({ type: 'CLEAR_CLIPBOARD' });

    if (response?.success) {
      console.info('[CLIPBOARD] Clipboard cleared via offscreen document');
    } else {
      throw new Error(response?.message || 'Failed to clear clipboard via offscreen');
    }
  } else {
    // Firefox and Safari use mv2 and can use direct clipboard access.
    await navigator.clipboard.writeText('');
  }
}

/**
 * Handle clipboard copied event - starts countdown and timer to clear clipboard.
 */
export async function handleClipboardCopied() : Promise<void> {
  const timeout = await LocalPreferencesService.getClipboardClearTimeout();

  // Clear any existing timer
  if (clipboardClearTimer) {
    clearTimeout(clipboardClearTimer);
    clipboardClearTimer = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  // Don't set timer if timeout is 0 (disabled)
  if (timeout === 0) {
    return;
  }

  // Generate new countdown ID
  currentCountdownId = Date.now();
  const thisCountdownId = currentCountdownId;
  countdownStartTime = Date.now();
  totalCountdownTime = timeout;

  remainingTime = timeout;

  // Send initial countdown immediately with ID
  sendMessage('CLIPBOARD_COUNTDOWN', { remaining: remainingTime, total: timeout, id: thisCountdownId }, 'popup').catch(() => {});

  // Send countdown updates to popup every 100ms for smooth animation
  let elapsed = 0;
  countdownInterval = setInterval(() => {
    // Check if this countdown is still active
    if (thisCountdownId !== currentCountdownId) {
      if (countdownInterval) {
        clearInterval(countdownInterval);
      }
      return;
    }

    elapsed += 0.1;
    remainingTime = Math.max(0, timeout - elapsed);
    sendMessage('CLIPBOARD_COUNTDOWN', { remaining: remainingTime, total: timeout, id: thisCountdownId }, 'popup').catch(() => {});

    if (elapsed >= timeout && countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }, 100);

  // Set timer to clear clipboard
  clipboardClearTimer = setTimeout(async () => {
    try {
      // Clear clipboard using offscreen document or fallback
      await clearClipboardContent();

      // Clean up regardless of success/failure
      clipboardClearTimer = null;
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }

      // Reset countdown tracking
      currentCountdownId = 0;
      countdownStartTime = 0;
      totalCountdownTime = 0;

      sendMessage('CLIPBOARD_CLEARED', {}, 'popup').catch(() => {});
    } catch (error) {
      console.error('[CLIPBOARD] Error during clipboard clear:', error);

      // Clean up even on error
      clipboardClearTimer = null;
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      currentCountdownId = 0;
      countdownStartTime = 0;
      totalCountdownTime = 0;
      sendMessage('CLIPBOARD_CLEARED', {}, 'popup').catch(() => {});
    }
  }, timeout * 1000);
}

/**
 * Cancel clipboard clear countdown and timer.
 */
export function handleCancelClipboardClear(): void {
  if (clipboardClearTimer) {
    clearTimeout(clipboardClearTimer);
    clipboardClearTimer = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  sendMessage('CLIPBOARD_COUNTDOWN_CANCELLED', {}, 'popup').catch(() => {});
}

/**
 * Get the clipboard clear timeout setting.
 */
export async function handleGetClipboardClearTimeout(): Promise<number> {
  return LocalPreferencesService.getClipboardClearTimeout();
}

/**
 * Set the clipboard clear timeout setting.
 */
export async function handleSetClipboardClearTimeout(data: number): Promise<boolean> {
  await LocalPreferencesService.setClipboardClearTimeout(data);
  return true;
}

/**
 * Get the current clipboard countdown state.
 */
export function handleGetClipboardCountdownState(): { remaining: number; total: number; id: number } | null {
  // Calculate actual remaining time based on elapsed time
  if (currentCountdownId && countdownStartTime && totalCountdownTime) {
    const elapsed = (Date.now() - countdownStartTime) / 1000;
    const actualRemaining = Math.max(0, totalCountdownTime - elapsed);

    if (actualRemaining > 0) {
      return {
        remaining: actualRemaining,
        total: totalCountdownTime,
        id: currentCountdownId
      };
    }
  }
  return null;
}
