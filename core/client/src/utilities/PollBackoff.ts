/**
 * Poll with exponential backoff in case of server unreachability.
 */

/** How often a client asks the server for new mail while polls are succeeding. */
export const MAILBOX_POLL_INTERVAL_MS = 2000;

/** Longest a client waits between mailbox polls, reached by doubling while polls keep failing. */
export const MAILBOX_POLL_MAX_INTERVAL_MS = 30000;

/**
 * How long to wait before the next mailbox poll.
 * @param consecutiveFailures - how many polls in a row have failed, 0 while polls are succeeding
 */
export function mailboxPollDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) {
    return MAILBOX_POLL_INTERVAL_MS;
  }

  return Math.min(
    MAILBOX_POLL_INTERVAL_MS * 2 ** consecutiveFailures,
    MAILBOX_POLL_MAX_INTERVAL_MS
  );
}
