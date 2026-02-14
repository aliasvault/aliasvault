import { sendMessage } from 'webext-bridge/content-script';

import { openAutofillPopup } from '@/entrypoints/contentScript/Popup';

import { LOGO_MARK_SVG } from '@/utils/constants/logo';
import type { Item } from '@/utils/dist/core/models/vault';
import { itemToCredential } from '@/utils/dist/core/models/vault';
import { FormDetector } from '@/utils/formDetector/FormDetector';
import { FormFiller } from '@/utils/formDetector/FormFiller';
import { ClickValidator } from '@/utils/security/ClickValidator';

/**
 * Global timestamp to track popup debounce time.
 * This is used to not show the popup again for a specific amount of time.
 * Used after autofill events to prevent spamming the popup from automatic
 * triggered browser events which can cause "focus" events to trigger.
 */
let popupDebounceTime = 0;

/**
 * ClickValidator instance for form security validation
 */
const clickValidator = ClickValidator.getInstance();

/**
 * Check if popup can be shown based on debounce time.
 */
export function popupDebounceTimeHasPassed() : boolean {
  if (Date.now() < popupDebounceTime) {
    return false;
  }

  return true;
}

/**
 * Hide popup for a specific amount of time.
 */
export function hidePopupFor(ms: number) : void {
  popupDebounceTime = Date.now() + ms;
}

/**
 * Validates if an element is a supported input field that can be processed for autofill.
 * This function supports regular input elements, custom elements with type attributes,
 * and custom web components that may contain shadow DOM.
 * @param element The element to validate
 * @returns An object containing validation result and the element cast as HTMLInputElement if valid
 */
export function validateInputField(element: Element | null): { isValid: boolean; inputElement?: HTMLInputElement } {
  if (!element) {
    return { isValid: false };
  }

  const textInputTypes = ['text', 'email', 'tel', 'password', 'search', 'url', 'number'];
  const elementType = element.getAttribute('type');
  const tagName = element.tagName.toLowerCase();
  const isInputElement = tagName === 'input';

  // Check if element has shadow DOM with input elements
  const elementWithShadow = element as HTMLElement & { shadowRoot?: ShadowRoot };
  const hasShadowDOMInput = elementWithShadow.shadowRoot &&
    elementWithShadow.shadowRoot.querySelector('input, textarea');

  // Check if it's a custom element that might be an input
  const isLikelyCustomInputElement = tagName.includes('-') && (
    tagName.includes('input') ||
    tagName.includes('field') ||
    tagName.includes('text') ||
    hasShadowDOMInput
  );

  // Check if it's a valid input field we should process
  const isValid = (
    // Case 1: It's an input element (with either explicit type or defaulting to "text")
    (isInputElement && (!elementType || textInputTypes.includes(elementType?.toLowerCase() ?? ''))) ||
    // Case 2: Non-input element but has valid type attribute
    (!isInputElement && elementType && textInputTypes.includes(elementType.toLowerCase())) ||
    // Case 3: It's a custom element that likely contains an input
    (isLikelyCustomInputElement)
  ) as boolean;

  return {
    isValid,
    inputElement: isValid ? (element as HTMLInputElement) : undefined
  };
}

/**
 * Fill item into current form.
 * Converts the Item to Credential format for FormFiller compatibility.
 *
 * @param item - The item to fill.
 * @param input - The input element that triggered the popup. Required when filling items to know which form to fill.
 */
export async function fillItem(item: Item, input: HTMLInputElement): Promise<void> {
  // Set debounce time to 300ms to prevent the popup from being shown again within 300ms because of autofill events.
  hidePopupFor(300);

  // Reset auto-lock timer when autofilling
  sendMessage('RESET_AUTO_LOCK_TIMER', {}, 'background').catch(() => {
    // Ignore errors as background script might not be ready
  });

  const formDetector = new FormDetector(document, input);
  const form = formDetector.getForm();

  if (!form) {
    // No form found, so we can't fill anything.
    return;
  }

  // Convert Item to Credential for FormFiller compatibility
  const credential = itemToCredential(item);
  const formFiller = new FormFiller(form, triggerInputEvents);
  await formFiller.fillFields(credential);
}

/**
 * Find the actual visible input element, either the element itself or a child input.
 * Certain websites use custom input element wrappers that not only contain the input but
 * also other elements like labels, icons, etc. As we want to position the icon relative to the actual
 * input, we try to find the actual input element. If there is no actual input element, we fallback
 * to the provided element.
 *
 * This method is optional, but it improves the AliasVault icon positioning on certain websites.
 *
 * @param element - The element to check.
 * @returns The actual input element to use for positioning.
 */
function findActualInput(element: HTMLElement): HTMLInputElement {
  // If it's already an input, return it
  if (element.tagName.toLowerCase() === 'input') {
    return element as HTMLInputElement;
  }

  // Try to find a visible child input in regular DOM
  const childInput = element.querySelector('input');
  if (childInput) {
    const style = window.getComputedStyle(childInput);
    if (style.display !== 'none' && style.visibility !== 'hidden') {
      return childInput;
    }
  }

  // Try to find input in shadow DOM if element has shadowRoot
  if (element.shadowRoot) {
    const shadowInput = element.shadowRoot.querySelector('input');
    if (shadowInput) {
      const style = window.getComputedStyle(shadowInput);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        return shadowInput as HTMLInputElement;
      }
    }
  }

  // Fallback to the provided element if no child input found
  return element as HTMLInputElement;
}

/**
 * Inject icon for a focused input element
 */
export function injectIcon(input: HTMLInputElement, container: HTMLElement): void {
  // Find the actual input element to use for positioning
  const actualInput = findActualInput(input);

  const ICON_HTML = `
<div class="av-input-icon">
  <img src="data:image/svg+xml;base64,${btoa(LOGO_MARK_SVG)}" style="width: 100%; height: 100%;" />
</div>
`;

  // Generate unique ID if input doesn't have one
  if (!actualInput.id) {
    actualInput.id = `aliasvault-input-${Math.random().toString(36).substring(2, 11)}`;
  }

  // Create an overlay container at document level if it doesn't exist
  let overlayContainer = container.querySelector('#aliasvault-overlay-container');
  if (!overlayContainer) {
    overlayContainer = document.createElement('div') as HTMLElement;
    overlayContainer.id = 'aliasvault-overlay-container';
    overlayContainer.className = 'av-overlay-container';
    container.appendChild(overlayContainer);
  }

  // Create the icon element from the HTML template
  const iconContainer = document.createElement('div');
  iconContainer.innerHTML = ICON_HTML;
  const icon = iconContainer.firstElementChild as HTMLElement;
  icon.setAttribute('data-icon-for', actualInput.id);

  // Enable pointer events just for the icon
  icon.style.pointerEvents = 'auto';

  /**
   * Update position of the icon.
   * Positions icon relative to right edge, moving it left by any existing padding.
   */
  const updateIconPosition = () : void => {
    const rect = actualInput.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(actualInput);
    const paddingRight = parseInt(computedStyle.paddingLeft + computedStyle.paddingRight);

    // Default offset is 32px, add any padding to move it further left
    const rightOffset = 24 + paddingRight;

    icon.style.position = 'fixed';
    icon.style.top = `${rect.top + (rect.height - 24) / 2}px`;
    icon.style.left = `${(rect.left + rect.width) - rightOffset}px`;
  };

  // Update position initially and on relevant events
  updateIconPosition();
  window.addEventListener('scroll', updateIconPosition, true);
  window.addEventListener('resize', updateIconPosition);

  // Add click event to trigger the autofill popup and refocus the input
  icon.addEventListener('click', async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Validate the click for security
    if (!await clickValidator.validateClick(e)) {
      console.warn('[AliasVault Security] Blocked autofill popup opening due to security validation failure');
      return;
    }

    setTimeout(() => actualInput.focus(), 0);
    openAutofillPopup(actualInput, container);
  });

  // Append the icon to the overlay container
  overlayContainer.appendChild(icon);

  // Fade in the icon
  requestAnimationFrame(() => {
    icon.style.opacity = '1';
  });

  /**
   * Remove the icon when the input loses focus.
   */
  const handleBlur = (): void => {
    icon.style.opacity = '0';
    setTimeout(() => {
      icon.remove();
      actualInput.removeEventListener('blur', handleBlur);
      actualInput.removeEventListener('keydown', handleKeyPress);
      window.removeEventListener('scroll', updateIconPosition, true);
      window.removeEventListener('resize', updateIconPosition);

      // Remove overlay container if it's empty
      if (!overlayContainer.children.length) {
        overlayContainer.remove();
      }
    }, 200);
  };

  /**
   * Handle key press to dismiss icon.
   */
  const handleKeyPress = (e: KeyboardEvent): void => {
    // Dismiss on Enter, Escape, or Tab.
    if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') {
      handleBlur();
    }
  };

  actualInput.addEventListener('blur', handleBlur);
  actualInput.addEventListener('keydown', handleKeyPress);
}

/**
 * Trigger input events for an element to trigger form validation
 * which some websites require before the "continue" button is enabled.
 */
function triggerInputEvents(element: HTMLInputElement | HTMLSelectElement, animate: boolean = true) : void {
  // Add keyframe animation if animation is requested
  if (animate) {
    // Create an overlay div that will show the highlight effect
    const overlay = document.createElement('div');

    /**
     * Update position of the overlay.
     */
    const updatePosition = () : void => {
      const rect = element.getBoundingClientRect();
      overlay.style.cssText = `
        position: fixed;
        z-index: 999999991;
        pointer-events: none;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        background-color: rgba(244, 149, 65, 0.3);
        border-radius: ${getComputedStyle(element).borderRadius};
        animation: fadeOut 1.4s ease-out forwards;
      `;
    };

    updatePosition();

    // Add scroll event listener
    window.addEventListener('scroll', updatePosition);

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeOut {
        0% { opacity: 1; transform: scale(1.02); }
        100% { opacity: 0; transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);

    // Remove overlay and cleanup after animation
    setTimeout(() => {
      window.removeEventListener('scroll', updatePosition);
      overlay.remove();
      style.remove();
    }, 1400);
  }

  // Trigger events
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));

  if (element.type === 'radio') {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
}
