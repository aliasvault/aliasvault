import { logFailure } from '@/utils/Diagnostics';

/**
 * Outcome of a click check: allowed, possibly hidden by the page (ask in the confirm window), or not a real click.
 */
export type ClickVerdict = 'allowed' | 'obscured' | 'rejected';

/** How long an element must have been visible before the press for the click to count. */
const MIN_VISIBLE_BEFORE_PRESS_MS = 100;

/** Selectors for top-layer elements. */
const TOP_LAYER_SELECTORS = [':popover-open', 'dialog:modal', ':fullscreen'];

/** IntersectionObserver v2 options (Chromium). */
type VisibilityObserverInit = IntersectionObserverInit & { trackVisibility: boolean; delay: number };

/** IntersectionObserver v2 entry. */
type VisibilityObserverEntry = IntersectionObserverEntry & { isVisible?: boolean };

/** Element with Firefox's content-script access to closed shadow roots. */
type ContentScriptElement = Element & { openOrClosedShadowRoot?: ShadowRoot | null };

/**
 * Checks clicks on the extension UI inside web pages, which the page can cover or make transparent.
 *
 * Chromium: a click counts only when the element was visible and uncovered before the press (IntersectionObserver v2).
 * Other browsers: page opacity checks and a top-layer scan at the click point, which a page can evade.
 */
export class ClickValidator {
  private static instance: ClickValidator | null = null;

  /** Visibility observer; null without IntersectionObserver v2. */
  private readonly visibilityObserver: IntersectionObserver | null;

  /** Since when each tracked element is visible, or null while it is not. */
  private readonly visibleSince = new WeakMap<Element, number | null>();

  /** Last press time per tracked element. */
  private readonly pressedAt = new WeakMap<Element, number>();

  /**
   * Create the validator.
   */
  private constructor() {
    this.visibilityObserver = ClickValidator.createVisibilityObserver((entries) => this.recordVisibility(entries));
  }

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
   * Start tracking `element`, so verifyClick can check clicks on it.
   */
  public trackVisibility(element: Element): void {
    if (this.visibilityObserver && !this.visibleSince.has(element)) {
      this.visibleSince.set(element, null);
      this.visibilityObserver.observe(element);
      element.addEventListener('pointerdown', (e) => this.pressedAt.set(element, e.timeStamp), { capture: true });
    }
  }

  /**
   * Check a click on a tracked `element`.
   */
  public verifyClick(event: MouseEvent, element: Element): ClickVerdict {
    try {
      if (!this.validateGesture(event).valid) {
        return 'rejected';
      }

      if (this.detectPageOpacityTricks().detected) {
        return 'obscured';
      }

      if (this.visibilityObserver) {
        const since = this.visibleSince.get(element);
        if (since === undefined || since === null) {
          return 'obscured';
        }

        // Not visible long enough before the press, e.g. an overlay removed at the press.
        const pressedAt = this.pressedAt.get(element) ?? event.timeStamp;
        return pressedAt - since >= MIN_VISIBLE_BEFORE_PRESS_MS ? 'allowed' : 'obscured';
      }

      return this.isCoveredByTopLayer(event.clientX, event.clientY) ? 'obscured' : 'allowed';
    } catch (error) {
      logFailure('[AliasVault Security] Click validation error', error);
      return 'rejected';
    }
  }

  /**
   * Create an IntersectionObserver v2, or null when unsupported.
   */
  private static createVisibilityObserver(callback: IntersectionObserverCallback): IntersectionObserver | null {
    if (typeof IntersectionObserver === 'undefined' || typeof IntersectionObserverEntry === 'undefined' || !('isVisible' in IntersectionObserverEntry.prototype)) {
      return null;
    }

    const options: VisibilityObserverInit = { trackVisibility: true, delay: 100 };
    return new IntersectionObserver(callback, options);
  }

  /**
   * Record visibility changes; stop tracking removed elements.
   */
  private recordVisibility(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries as VisibilityObserverEntry[]) {
      if (!entry.target.isConnected) {
        this.visibilityObserver?.unobserve(entry.target);
        this.visibleSince.delete(entry.target);
      } else if (!entry.isVisible) {
        this.visibleSince.set(entry.target, null);
      } else if (this.visibleSince.get(entry.target) === null) {
        this.visibleSince.set(entry.target, entry.time);
      }
    }
  }

  /**
   * Whether a top-layer element covers the point.
   */
  private isCoveredByTopLayer(x: number, y: number): boolean {
    return this.findTopLayerElements(document).some((element) => {
      const rect = element.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    });
  }

  /**
   * Find top-layer elements under `root`, including inside shadow roots.
   */
  private findTopLayerElements(root: Document | ShadowRoot): Element[] {
    const found: Element[] = [];
    for (const selector of TOP_LAYER_SELECTORS) {
      try {
        found.push(...root.querySelectorAll(selector));
      } catch {
        // Unsupported selector.
      }
    }

    for (const element of root.querySelectorAll('*')) {
      const shadowRoot = (element as ContentScriptElement).openOrClosedShadowRoot ?? element.shadowRoot;
      if (shadowRoot) {
        found.push(...this.findTopLayerElements(shadowRoot));
      }
    }

    return found;
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
