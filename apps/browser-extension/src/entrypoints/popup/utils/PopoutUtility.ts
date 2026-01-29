/**
 * Utility class for handling popup window operations
 */
export class PopoutUtility {
  /**
   * Check if the current page is an expanded popup.
   * Uses both URL parameter detection and window width as fallback.
   */
  public static isPopup(): boolean {
    // Primary method: Check URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('expanded') === 'true') {
      return true;
    }

    /**
     * Fallback method: Check window width (popout windows are 800px wide)
     * Regular popup extension windows are typically narrower (around 375-400px)
     */
    return window.innerWidth > 390;
  }

  /**
   * Get the return path from URL parameters (used for back navigation in expanded popups).
   * @returns The return path if set, or null
   */
  public static getReturnPath(): string | null {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('returnTo');
  }

  /**
   * Open the current page in a new expanded popup window.
   * @param path - The path to open in the popup (defaults to current path)
   * @param returnTo - Optional path to return to when back button is pressed
   */
  public static openInNewPopup(path?: string, returnTo?: string): void {
    const width = 800;
    const height = 1000;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const currentPath = path || window.location.hash.replace('#', '');

    // Build URL with parameters
    const params = new URLSearchParams();
    params.set('expanded', 'true');
    if (returnTo) {
      params.set('returnTo', returnTo);
    }

    const popupUrl = `popup.html?${params.toString()}#${currentPath}`;

    window.open(
      popupUrl,
      'AliasVaultPopup',
      `width=${width},height=${height},left=${left},top=${top},popup=true`
    );

    window.close();
  }
}
