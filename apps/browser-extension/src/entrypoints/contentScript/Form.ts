import { sendMessage } from 'webext-bridge/content-script';

import { openAutofillPopup } from '@/entrypoints/contentScript/Popup';

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

  const aliasvaultIconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg enable-background="new 0 0 500 500" version="1.1" viewBox="0 0 500 500" xml:space="preserve" xmlns="http://www.w3.org/2000/svg">
<path d="m459.87 294.95c0.016205 5.4005 0.03241 10.801-0.35022 16.873-1.111 6.3392-1.1941 12.173-2.6351 17.649-10.922 41.508-36.731 69.481-77.351 83.408-7.2157 2.4739-14.972 3.3702-22.479 4.995-23.629 0.042205-47.257 0.11453-70.886 0.12027-46.762 0.011322-93.523-0.01416-140.95-0.43411-8.59-2.0024-16.766-2.8352-24.398-5.3326-21.595-7.0666-39.523-19.656-53.708-37.552-10.227-12.903-17.579-27.17-21.28-43.221-1.475-6.3967-2.4711-12.904-3.6852-19.361-0.051849-5.747-0.1037-11.494 0.26915-17.886 4.159-42.973 27.68-71.638 63.562-92.153 0-0.70761-0.001961-1.6988 3.12e-4 -2.69 0.022484-9.8293-1.3071-19.894 0.35664-29.438 3.2391-18.579 11.08-35.272 23.763-49.773 12.098-13.832 26.457-23.989 43.609-30.029 7.813-2.7512 16.14-4.0417 24.234-5.9948 7.392-0.025734 14.784-0.05146 22.835 0.32253 4.1959 0.95392 7.7946 1.2538 11.258 2.1053 17.16 4.2192 32.287 12.176 45.469 24.104 2.2558 2.0411 4.372 6.6241 9.621 3.868 16.839-8.8419 34.718-11.597 53.603-8.594 16.791 2.6699 31.602 9.4308 44.236 20.636 11.531 10.227 19.84 22.841 25.393 37.236 6.3436 16.445 10.389 33.163 6.0798 49.389 7.9587 8.9321 15.807 16.704 22.421 25.414 9.162 12.065 15.33 25.746 18.144 40.776 0.97046 5.1848 1.9111 10.375 2.8654 15.563m-71.597 71.012c5.5615-5.2284 12.002-9.7986 16.508-15.817 10.474-13.992 14.333-29.916 11.288-47.446-2.2496-12.95-8.1973-24.076-17.243-33.063-12.746-12.663-28.865-18.614-46.786-18.569-69.912 0.17712-139.82 0.56831-209.74 0.96176-15.922 0.089599-29.168 7.4209-39.685 18.296-14.45 14.944-20.408 33.343-16.655 54.368 2.2763 12.754 8.2167 23.748 17.158 32.66 13.299 13.255 30.097 18.653 48.728 18.651 59.321-0.005188 118.64 0.042358 177.96-0.046601 9.5912-0.014374 19.181-0.86588 28.773-0.88855 10.649-0.025146 19.978-3.825 29.687-9.1074z" fill="#EEC170"/>
<path d="m162.77 293c15.654 4.3883 20.627 22.967 10.304 34.98-5.3104 6.1795-14.817 8.3208-24.278 5.0472-7.0723-2.4471-12.332-10.362-12.876-17.933-1.0451-14.542 11.089-23.176 21.705-23.046 1.5794 0.019287 3.1517 0.61566 5.1461 0.95184z" fill="#EEC170"/>
<path d="m227.18 293.64c7.8499 2.3973 11.938 8.2143 13.524 15.077 1.8591 8.0439-0.44817 15.706-7.1588 21.121-6.7633 5.4572-14.417 6.8794-22.578 3.1483-8.2972-3.7933-12.836-10.849-12.736-19.438 0.1687-14.497 14.13-25.368 28.948-19.908z" fill="#EEC170"/>
<path d="m261.57 319.07c-2.495-14.418 4.6853-22.603 14.596-26.108 9.8945-3.4995 23.181 3.4303 26.267 13.779 4.6504 15.591-7.1651 29.064-21.665 28.161-8.5254-0.53088-17.202-6.5094-19.198-15.831z" fill="#EEC170"/>
<path d="m336.91 333.41c-9.0175-4.2491-15.337-14.349-13.829-21.682 3.0825-14.989 13.341-20.304 23.018-19.585 10.653 0.79141 17.93 7.407 19.765 17.547 1.9588 10.824-4.1171 19.939-13.494 23.703-5.272 2.1162-10.091 1.5086-15.46 0.017883z" fill="#EEC170"/>
</svg>`;

  const ICON_HTML = `
<div class="av-input-icon">
  <img src="data:image/svg+xml;base64,${btoa(aliasvaultIconSvg)}" style="width: 100%; height: 100%;" />
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
