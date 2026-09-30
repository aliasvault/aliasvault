/**
 * Wait until the browser has painted, so a loading indicator is on screen before synchronous heavy work blocks the thread.
 * Resolves at once where nothing is painted (service worker, Node). The timeout covers hidden tabs, where
 * requestAnimationFrame does not fire.
 */
export function yieldToPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 100);
  });
}
