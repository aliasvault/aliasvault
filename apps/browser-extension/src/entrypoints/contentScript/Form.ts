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

  // Static base64-encoded AliasVault logo SVG (pre-computed for performance)
  const ALIASVAULT_LOGO_BASE64 = 'PHN2ZyBlbmFibGUtYmFja2dyb3VuZD0ibmV3IDAgMCA1MDAgNTAwIiB2aWV3Qm94PSIwIDAgNTAwIDUwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJtNDU5Ljg3IDI5NC45NWMwLjAxNjIwNSA1LjQwMDUgMC4wMzI0MSAxMC44MDEtMC4zNTAyMiAxNi44NzMtMS4xMTEgNi4zMzkyLTEuMTk0MSAxMi4xNzMtMi42MzUxIDE3LjY0OS0xMC45MjIgNDEuNTA4LTM2LjczMSA2OS40ODEtNzcuMzUxIDgzLjQwOC03LjIxNTcgMi40NzM5LTE0Ljk3MiAzLjM3MDItMjIuNDc5IDQuOTk1LTIzLjYyOSAwLjA0MjIwNS00Ny4yNTcgMC4xMTQ1My03MC44ODYgMC4xMjAyNy00Ni43NjIgMC4wMTEzMjItOTMuNTIzLTAuMDE0MTYtMTQwLjk1LTAuNDM0MTEtOC41OS0yLjAwMjQtMTYuNzY2LTIuODM1Mi0yNC4zOTgtNS4zMzI2LTIxLjU5NS03LjA2NjYtMzkuNTIzLTE5LjY1Ni01My43MDgtMzcuNTUyLTEwLjIyNy0xMi45MDMtMTcuNTc5LTI3LjE3LTIxLjI4LTQzLjIyMS0xLjQ3NS02LjM5NjctMi40NzExLTEyLjkwNC0zLjY4NTItMTkuMzYxLTAuMDUxODQ5LTUuNzQ3LTAuMTAzNy0xMS40OTQgMC4yNjkxNS0xNy44ODYgNC4xNTktNDIuOTczIDI3LjY4LTcxLjYzOCA2My41NjItOTIuMTUzIDAtMC43MDc2MS0wLjAwMTk2MS0xLjY5ODggMy4xMmUtNCAtMi42OSAwLjAyMjQ4NC05LjgyOTMtMS4zMDcxLTE5Ljg5NCAwLjM1NjY0LTI5LjQzOCAzLjIzOTEtMTguNTc5IDExLjA4LTM1LjI3MiAyMy43NjMtNDkuNzczIDEyLjA5OC0xMy44MzIgMjYuNDU3LTIzLjk4OSA0My42MDktMzAuMDI5IDcuODEzLTIuNzUxMiAxNi4xNC00LjA0MTcgMjQuMjM0LTUuOTk0OCA3LjM5Mi0wLjAyNTczNCAxNC43ODQtMC4wNTE0NiAyMi44MzUgMC4zMjI1MyA0LjE5NTkgMC45NTM5MiA3Ljc5NDYgMS4yNTM4IDExLjI1OCAyLjEwNTMgMTcuMTYgNC4yMTkyIDMyLjI4NyAxMi4xNzYgNDUuNDY5IDI0LjEwNCAyLjI1NTggMi4wNDExIDQuMzcyIDYuNjI0MSA5LjYyMSAzLjg2OCAxNi44MzktOC44NDE5IDM0LjcxOC0xMS41OTcgNTMuNjAzLTguNTk0IDE2Ljc5MSAyLjY2OTkgMzEuNjAyIDkuNDMwOCA0NC4yMzYgMjAuNjM2IDExLjUzMSAxMC4yMjcgMTkuODQgMjIuODQxIDI1LjM5MyAzNy4yMzYgNi4zNDM2IDE2LjQ0NSAxMC4zODkgMzMuMTYzIDYuMDc5OCA0OS4zODkgNy45NTg3IDguOTMyMSAxNS44MDcgMTYuNzA0IDIyLjQyMSAyNS40MTQgOS4xNjIgMTIuMDY1IDE1LjMzIDI1Ljc0NiAxOC4xNDQgNDAuNzc2IDAuOTcwNDYgNS4xODQ4IDEuOTExMSAxMC4zNzUgMi44NjU0IDE1LjU2M20tNzEuNTk3IDcxLjAxMmM1LjU2MTUtNS4yMjg0IDEyLjAwMi05Ljc5ODYgMTYuNTA4LTE1LjgxNyAxMC40NzQtMTMuOTkyIDE0LjMzMy0yOS45MTYgMTEuMjg4LTQ3LjQ0Ni0yLjI0OTYtMTIuOTUtOC4xOTczLTI0LjA3Ni0xNy4yNDMtMzMuMDYzLTEyLjc0Ni0xMi42NjMtMjguODY1LTE4LjYxNC00Ni43ODYtMTguNTY5LTY5LjkxMiAwLjE3NzEyLTEzOS44MiAwLjU2ODMxLTIwOS43NCAwLjk2MTc2LTE1LjkyMiAwLjA4OTU5OS0yOS4xNjggNy40MjA5LTM5LjY4NSAxOC4yOTYtMTQuNDUgMTQuOTQ0LTIwLjQwOCAzMy4zNDMtMTYuNjU1IDU0LjM2OCAyLjI3NjMgMTIuNzU0IDguMjE2NyAyMy43NDggMTcuMTU4IDMyLjY2IDEzLjI5OSAxMy4yNTUgMzAuMDk3IDE4LjY1MyA0OC43MjggMTguNjUxIDU5LjMyMS0wLjAwNTE4OCAxMTguNjQgMC4wNDIzNTggMTc3Ljk2LTAuMDQ2NjAxIDkuNTkxMi0wLjAxNDM3NCAxOS4xODEtMC44NjU4OCAyOC43NzMtMC44ODg1NSAxMC42NDktMC4wMjUxNDYgMTkuOTc4LTMuODI1IDI5LjY4Ny05LjEwNzR6IiBmaWxsPSIjRUVDMTcwIi8+PHBhdGggZD0ibTE2Mi43NyAyOTNjMTUuNjU0IDQuMzg4MyAyMC42MjcgMjIuOTY3IDEwLjMwNCAzNC45OC01LjMxMDQgNi4xNzk1LTE0LjgxNyA4LjMyMDgtMjQuMjc4IDUuMDQ3Mi03LjA3MjMtMi40NDcxLTEyLjMzMi0xMC4zNjItMTIuODc2LTE3LjkzMy0xLjA0NTEtMTQuNTQyIDExLjA4OS0yMy4xNzYgMjEuNzA1LTIzLjA0NiAxLjU3OTQgMC4wMTkyODcgMy4xNTE3IDAuNjE1NjYgNS4xNDYxIDAuOTUxODR6IiBmaWxsPSIjRUVDMTcwIi8+PHBhdGggZD0ibTIyNy4xOCAyOTMuNjRjNy44NDk5IDIuMzk3MyAxMS45MzggOC4yMTQzIDEzLjUyNCAxNS4wNzcgMS44NTkxIDguMDQzOS0wLjQ0ODE3IDE1LjcwNi03LjE1ODggMjEuMTIxLTYuNzYzMyA1LjQ1NzItMTQuNDE3IDYuODc5NC0yMi41NzggMy4xNDgzLTguMjk3Mi0zLjc5MzMtMTIuODM2LTEwLjg0OS0xMi43MzYtMTkuNDM4IDAuMTY4Ny0xNC40OTcgMTQuMTMtMjUuMzY4IDI4Ljk0OC0xOS45MDh6IiBmaWxsPSIjRUVDMTcwIi8+PHBhdGggZD0ibTI2MS41NyAzMTkuMDdjLTIuNDk1LTE0LjQxOCA0LjY4NTMtMjIuNjAzIDE0LjU5Ni0yNi4xMDggOS44OTQ1LTMuNDk5NSAyMy4xODEgMy40MzAzIDI2LjI2NyAxMy43NzkgNC42NTA0IDE1LjU5MS03LjE2NTEgMjkuMDY0LTIxLjY2NSAyOC4xNjEtOC41MjU0LTAuNTMwODgtMTcuMjAyLTYuNTA5NC0xOS4xOTgtMTUuODMxeiIgZmlsbD0iI0VFQzE3MCIvPjxwYXRoIGQ9Im0zMzYuOTEgMzMzLjQxYy05LjAxNzUtNC4yNDkxLTE1LjMzNy0xNC4zNDktMTMuODI5LTIxLjY4MiAzLjA4MjUtMTQuOTg5IDEzLjM0MS0yMC4zMDQgMjMuMDE4LTE5LjU4NSAxMC42NTMgMC43OTE0MSAxNy45MyA3LjQwNyAxOS43NjUgMTcuNTQ3IDEuOTU4OCAxMC44MjQtNC4xMTcxIDE5LjkzOS0xMy40OTQgMjMuNzAzLTUuMjcyIDIuMTE2Mi0xMC4wOTEgMS41MDg2LTE1LjQ2IDAuMDE3ODgzeiIgZmlsbD0iI0VFQzE3MCIvPjwvc3ZnPg==';

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

  // Create the icon element using DOM methods
  const icon = document.createElement('div');
  icon.className = 'av-input-icon';
  icon.setAttribute('data-icon-for', actualInput.id);

  const iconImg = document.createElement('img');
  iconImg.src = `data:image/svg+xml;base64,${ALIASVAULT_LOGO_BASE64}`;
  iconImg.style.width = '100%';
  iconImg.style.height = '100%';
  icon.appendChild(iconImg);

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
