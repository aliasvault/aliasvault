/**
 * Resolve after the given number of milliseconds.
 * @param ms - milliseconds to wait
 */
export const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wait out the rest of a minimum display time, so a fast operation does not lead to UI flicker.
 * @param startedAt - Date.now() when the operation started
 * @param minimumMs - the minimum time in milliseconds since startedAt
 */
export const waitForMinimumDuration = (startedAt: number, minimumMs: number): Promise<void> => delay(Math.max(0, minimumMs - (Date.now() - startedAt)));
