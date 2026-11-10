import { logFailure } from '@/utils/Diagnostics';
import type { AutofillConfirmAnswer, AutofillConfirmation } from '@/utils/types/messaging/AutofillConfirmation';
import type { BoolResponse } from '@/utils/types/messaging/BoolResponse';

import { browser } from '#imports';

/**
 * A fill waiting for the user's answer in the confirmation window.
 */
type PendingConfirmation = {
  confirmation: AutofillConfirmation;
  tabId?: number;
  windowId?: number;
  settle: (answer: AutofillConfirmAnswer) => void;
};

/** Unanswered confirmations by request id. */
const pendingConfirmations = new Map<string, PendingConfirmation>();

/**
 * Ask the user in an extension window, which the page cannot cover or click through, whether to fill an item into the page.
 * Resolves 'cancel' when the user cancels or closes the window, or when the same tab asks again.
 */
export async function confirmAutofillInWindow(confirmation: AutofillConfirmation, tabId: number | undefined): Promise<AutofillConfirmAnswer> {
  // One question per tab: a newer pick replaces an unanswered one.
  if (tabId !== undefined) {
    for (const [requestId, pending] of pendingConfirmations) {
      if (pending.tabId === tabId) {
        await settleConfirmation(requestId, 'cancel');
      }
    }
  }

  const requestId = crypto.randomUUID();
  const url = browser.runtime.getURL('/popup.html') + '#/autofill/confirm?' + new URLSearchParams({ requestId }).toString();

  return new Promise<AutofillConfirmAnswer>((resolve) => {
    let closedCheck: ReturnType<typeof setInterval> | undefined;
    const pending: PendingConfirmation = {
      confirmation,
      tabId,
      /**
       * Stop watching the window and hand the answer to the waiting fill.
       */
      settle: (answer) => {
        clearInterval(closedCheck);
        resolve(answer);
      },
    };
    pendingConfirmations.set(requestId, pending);

    browser.windows.create({ url, type: 'popup', width: 450, height: 600, focused: true }).then(async (created) => {
      pending.windowId = created?.id;
      if (!pendingConfirmations.has(requestId)) {
        // Replaced or answered while the window was opening.
        await closeWindow(pending.windowId);
        return;
      }

      // Treat a closed window as a cancel; the poll also keeps the service worker alive while the user decides.
      closedCheck = setInterval(async () => {
        try {
          await browser.windows.get(pending.windowId!);
        } catch {
          await settleConfirmation(requestId, 'cancel');
        }
      }, 1000);
    }).catch(async (error) => {
      logFailure('Failed to open the autofill confirmation window', error);
      await settleConfirmation(requestId, 'cancel');
    });
  });
}

/**
 * The details the confirmation window shows, or null for an unknown or answered request.
 */
export function handleGetAutofillConfirmation(data: { requestId: string }): AutofillConfirmation | null {
  return pendingConfirmations.get(data.requestId)?.confirmation ?? null;
}

/**
 * Take the user's answer from the confirmation window and close it.
 */
export async function handleResolveAutofillConfirmation(data: { requestId: string; answer: AutofillConfirmAnswer }): Promise<BoolResponse> {
  if (!pendingConfirmations.has(data.requestId)) {
    return { success: false };
  }

  const answer: AutofillConfirmAnswer = data.answer === 'link' || data.answer === 'fill' ? data.answer : 'cancel';
  await settleConfirmation(data.requestId, answer);
  return { success: true };
}

/**
 * Answer a pending confirmation and close its window.
 */
async function settleConfirmation(requestId: string, answer: AutofillConfirmAnswer): Promise<void> {
  const pending = pendingConfirmations.get(requestId);
  if (!pending) {
    return;
  }

  pendingConfirmations.delete(requestId);
  pending.settle(answer);
  await closeWindow(pending.windowId);
}

/**
 * Close a confirmation window from the background, since window.close() in the page does not work in every browser.
 */
async function closeWindow(windowId: number | undefined): Promise<void> {
  if (windowId === undefined) {
    return;
  }

  try {
    await browser.windows.remove(windowId);
  } catch {
    // Already closed.
  }
}
