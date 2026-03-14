/**
 * Background email alarm handler — polls emailCount via indexer every 3 minutes.
 * Updates extension badge when new emails are detected.
 *
 * Uses chrome.alarms for MV3 service worker persistence (survives restarts).
 * Badge cleared when popup sends CLEAR_EMAIL_BADGE message on inbox mount.
 */

const EMAIL_ALARM_NAME = 'check-email';
const EMAIL_ALARM_PERIOD_MINUTES = 3;
const LAST_KNOWN_EMAIL_COUNT_KEY = 'lastKnownEmailCount';
const BADGE_COLOR = '#ef4444'; // red-500

/**
 * Register the email polling alarm. Called when user has email feature enabled.
 */
export async function registerEmailAlarm(): Promise<void> {
  await chrome.alarms.create(EMAIL_ALARM_NAME, {
    periodInMinutes: EMAIL_ALARM_PERIOD_MINUTES,
  });
}

/**
 * Unregister the email polling alarm. Called on logout/disconnect.
 */
export async function unregisterEmailAlarm(): Promise<void> {
  await chrome.alarms.clear(EMAIL_ALARM_NAME);
}

/**
 * Handle email alarm fire — one-shot indexer read to check emailCount.
 * Updates badge if new emails detected.
 *
 * @param readEmailCount - Function to read current emailCount from indexer
 */
export async function handleEmailAlarm(
  readEmailCount: () => Promise<number>,
): Promise<void> {
  const currentCount = await readEmailCount();
  const stored = await chrome.storage.local.get(LAST_KNOWN_EMAIL_COUNT_KEY);
  const lastKnown = (stored[LAST_KNOWN_EMAIL_COUNT_KEY] as number) ?? 0;

  if (currentCount > lastKnown) {
    const newCount = currentCount - lastKnown;
    await chrome.action.setBadgeText({ text: String(newCount) });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await chrome.storage.local.set({ [LAST_KNOWN_EMAIL_COUNT_KEY]: currentCount });
  }
}

/**
 * Clear the email badge. Called when popup opens inbox page.
 */
export async function clearEmailBadge(): Promise<void> {
  await chrome.action.setBadgeText({ text: '' });
}

/**
 * Setup alarm listener. Call once during background script initialization.
 *
 * @param readEmailCount - Function to read current emailCount from indexer
 */
export function setupEmailAlarmListener(
  readEmailCount: () => Promise<number>,
): void {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== EMAIL_ALARM_NAME) return;
    try {
      await handleEmailAlarm(readEmailCount);
    } catch (error) {
      console.error('Email alarm handler error:', error);
    }
  });
}
