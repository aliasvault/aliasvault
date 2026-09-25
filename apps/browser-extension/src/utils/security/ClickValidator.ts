import { logFailure } from '@/utils/Diagnostics';
/**
 * ClickValidator - Simplified click validation system for content script security
 *
 * Validates user clicks with focus on content script shadow DOM scenarios:
 * - Detection of page-wide opacity tricks on BODY/HTML
 * - Basic gesture authenticity validation
 */
export class ClickValidator {
  private static instance: ClickValidator | null = null;

  /**
   * Get or create singleton instance
   */
  public static getInstance(): ClickValidator {
    if (!ClickValidator.instance) {
      ClickValidator.instance = new ClickValidator();
    }
    return ClickValidator.instance;
  }

  /**
   * Validate a click event (simplified for content scripts)
   */
  public async validateClick(event: MouseEvent): Promise<boolean> {

    try {
      // 1. Check for page-wide opacity tricks on BODY/HTML
      const opacityTrickResult = this.detectPageOpacityTricks();

      if (opacityTrickResult.detected) {
        return false;
      }

      // 2. Basic gesture validation
      const gestureResult = this.validateGesture(event);

      if (!gestureResult.valid) {
        return false;
      }

      return true;

    } catch (error) {
      logFailure('[AliasVault Security] Click validation error', error);
      return false;
    }
  }

  /**
   * Detect page-wide opacity tricks on BODY/HTML elements
   */
  private detectPageOpacityTricks(): { detected: boolean; reason?: string } {
    try {
      const html = document.documentElement;
      const body = document.body;

      // Check HTML element opacity
      if (html) {
        const htmlStyle = getComputedStyle(html);
        const htmlOpacity = parseFloat(htmlStyle.opacity);

        if (htmlOpacity < 0.9) {
          return {
            detected: true,
            reason: `HTML element opacity reduced to ${htmlOpacity} - potential clickjacking attempt`
          };
        }

        // Check for CSS filters that could obscure content
        if (htmlStyle.filter && htmlStyle.filter !== 'none') {
          return {
            detected: true,
            reason: `HTML element has CSS filter applied: ${htmlStyle.filter} - potential visual manipulation`
          };
        }
      }

      // Check BODY element opacity
      if (body) {
        const bodyStyle = getComputedStyle(body);
        const bodyOpacity = parseFloat(bodyStyle.opacity);

        if (bodyOpacity < 0.9) {
          return {
            detected: true,
            reason: `BODY element opacity reduced to ${bodyOpacity} - potential clickjacking attempt`
          };
        }

        // Check for CSS filters on body
        if (bodyStyle.filter && bodyStyle.filter !== 'none') {
          return {
            detected: true,
            reason: `BODY element has CSS filter applied: ${bodyStyle.filter} - potential visual manipulation`
          };
        }
      }

      return { detected: false };
    } catch (error) {
      return {
        detected: true,
        reason: `Error checking page opacity: ${error}`
      };
    }
  }

  /**
   * Validate gesture characteristics for human-like behavior
   */
  private validateGesture(event: MouseEvent): { valid: boolean; reason?: string } {
    // Check for basic gesture properties

    // Mouse events should have reasonable coordinates
    if (event.clientX < 0 || event.clientY < 0 ||
        event.clientX > window.innerWidth || event.clientY > window.innerHeight) {
      return {
        valid: false,
        reason: 'Click coordinates outside viewport'
      };
    }

    // Check for reasonable button values
    if (event.button !== 0) { // Only left-click should trigger credentials
      return {
        valid: false,
        reason: `Non-left-click detected: button ${event.button}`
      };
    }

    return { valid: true };
  }
}
