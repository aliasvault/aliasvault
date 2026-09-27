/**
 * Focus an element, retrying each frame until it takes focus. On a full page load index.html keeps #app hidden
 * behind the loading screen for at least a second, and a hidden element ignores focus().
 * Returns a cancel function for use as an effect cleanup.
 */
export function focusWhenVisible(getElement: () => HTMLElement | null, timeoutMs = 5000): () => void {
  const start = performance.now();
  let frame = 0;

  /**
   * Try to focus once; schedule another try while the element does not have focus yet.
   */
  const attempt = (): void => {
    const element = getElement();
    element?.focus();
    if ((element && document.activeElement === element) || performance.now() - start > timeoutMs) {
      return;
    }
    frame = requestAnimationFrame(attempt);
  };

  attempt();
  return (): void => cancelAnimationFrame(frame);
}
