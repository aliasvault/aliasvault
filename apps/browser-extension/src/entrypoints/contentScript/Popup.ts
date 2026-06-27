import * as OTPAuth from 'otpauth';

import { fillItem, fillTotpCode } from '@/entrypoints/contentScript/Form';

import { ItemTypeIconSvgs } from '@/utils/dist/core/models/icons';
import type { Item } from '@/utils/dist/core/models/vault';
import { FieldKey, getFieldValue } from '@/utils/dist/core/models/vault';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import { ClickValidator } from '@/utils/security/ClickValidator';
import { ServiceDetectionUtility } from '@/utils/serviceDetection/ServiceDetectionUtility';
import { SqliteClient } from '@/utils/SqliteClient';

import { t } from '@/i18n/StandaloneI18n';

import { getCurrentAutofillFrameUrl } from './AutofillFrameUrl';
import { completeConditionalWithPasskey, getConditionalPasskeyOptions, hasPendingConditionalRequest } from './ConditionalPasskey';

/**
 * The input element the autofill popup was most recently shown for. Used as a fallback fill
 * target when a credential is created in the full popup window and filled back into the page.
 */
let lastAutofillInput: HTMLInputElement | null = null;

/**
 * Get the input element the autofill popup was most recently shown for (may be null).
 */
export function getLastAutofillInput(): HTMLInputElement | null {
  return lastAutofillInput;
}

/*
 * Dimensions of the create-credential popup window (must match browser.windows.create in the
 * background's handleOpenPopupCreateCredential), used to keep it fully on-screen when positioning.
 */
const CREATE_POPUP_WIDTH = 400;
const CREATE_POPUP_HEIGHT = 600;

/**
 * Compute an on-screen top-left position for the create-credential window from a click event, so it
 * opens centered on where the user clicked rather than in the screen corner. Returns null when no
 * pointer position is available (e.g. keyboard activation), letting the browser pick a default.
 */
function getCreatePopupPosition(e: Event): { left: number; top: number } | null {
  const mouse = e as MouseEvent;
  if (!mouse.screenX && !mouse.screenY) {
    return null;
  }

  // availLeft/availTop are non-standard but widely supported; fall back to 0 when absent.
  const screenInfo = window.screen as Screen & { availLeft?: number; availTop?: number };
  const availLeft = screenInfo.availLeft ?? 0;
  const availTop = screenInfo.availTop ?? 0;

  // Center the window on the cursor, then clamp so the whole window stays within the screen.
  const left = Math.max(availLeft, Math.min(mouse.screenX - CREATE_POPUP_WIDTH / 2, availLeft + screenInfo.availWidth - CREATE_POPUP_WIDTH));
  const top = Math.max(availTop, Math.min(mouse.screenY - CREATE_POPUP_HEIGHT / 2, availTop + screenInfo.availHeight - CREATE_POPUP_HEIGHT));

  return { left: Math.round(left), top: Math.round(top) };
}

/**
 * WeakMap to store event listeners for popup containers
 */
let popupListeners = new WeakMap<HTMLElement, EventListener>();

/**
 * Global ClickValidator instance for content script security
 */
const clickValidator = ClickValidator.getInstance();

/**
 * Active TOTP update interval ID for cleanup
 */
let totpUpdateIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Cleanup TOTP update interval
 */
function cleanupTotpInterval(): void {
  if (totpUpdateIntervalId !== null) {
    clearInterval(totpUpdateIntervalId);
    totpUpdateIntervalId = null;
  }
}

/**
 * Generate TOTP code from secret key
 */
function generateTotpCode(secretKey: string): string {
  try {
    const totp = new OTPAuth.TOTP({
      secret: secretKey,
      algorithm: 'SHA1',
      digits: 6,
      period: 30
    });
    const code = totp.generate();
    // Format as "XXX XXX" with space in middle
    return `${code.slice(0, 3)} ${code.slice(3)}`;
  } catch {
    return '--- ---';
  }
}

/**
 * Get remaining seconds until next TOTP code
 */
function getTotpRemainingSeconds(): number {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

/**
 * Check if an outside-click event originated from AliasVault UI controls.
 */
function isClickInsidePopupUi(event: MouseEvent, popup: Element, input: HTMLInputElement): boolean {
  const eventPath = event.composedPath();

  if (eventPath.includes(popup) || eventPath.includes(input)) {
    return true;
  }

  if (eventPath.some((pathTarget) => pathTarget instanceof Element && pathTarget.closest('.av-input-icon') !== null)) {
    return true;
  }

  const rootNode = popup.getRootNode();
  if (rootNode instanceof ShadowRoot && (event.target === rootNode.host || eventPath.includes(rootNode.host))) {
    return true;
  }

  return false;
}

/**
 * Open (or refresh) the autofill popup including check if vault is locked.
 * @param input - The input element that triggered the popup
 * @param container - The container element
 * @param forceShow - If true, always show the popup even if dismissed (for manual icon clicks)
 */
export function openAutofillPopup(input: HTMLInputElement, container: HTMLElement, forceShow: boolean = false) : void {
  createLoadingPopup(input, '', container);

  /**
   * Handle the Enter key.
   */
  const handleEnterKey = (e: KeyboardEvent) : void => {
    if (e.key === 'Enter') {
      removeExistingPopup(container);
      // Remove the event listener to clean up
      document.body.removeEventListener('keydown', handleEnterKey);
    }
  };

  document.addEventListener('keydown', handleEnterKey);

  (async () : Promise<void> => {
    const currentUrl = getCurrentAutofillFrameUrl();
    if (!currentUrl) {
      removeExistingPopup(container);
      document.removeEventListener('keydown', handleEnterKey);
      return;
    }

    // Load autofill matching mode setting to send to background for filtering
    const matchingMode = await LocalPreferencesService.getAutofillMatchingMode();

    const response = await sendMessage('GET_FILTERED_ITEMS', {
      currentUrl,
      pageTitle: document.title,
      matchingMode: matchingMode,
      includeRecentlySelected: true // Enable for multi-step login autofill
    });

    if (response.success) {
      await createAutofillPopup(input, response.items, container, response.recentlySelectedId);
    } else {
      // Check if the user has dismissed the vault locked popup (only for auto-show, not manual clicks)
      if (!forceShow) {
        const dismissUntil = await LocalPreferencesService.getVaultLockedDismissUntil();
        if (dismissUntil && Date.now() < dismissUntil) {
          // User has dismissed the popup, don't show it again
          removeExistingPopup(container);
          return;
        }
      }

      await createVaultLockedPopup(input, container);
    }
  })();
}

/**
 * Open (or refresh) the TOTP autofill popup for 2FA code fields.
 * Shows only items that have TOTP codes stored.
 * @param input - The input element that triggered the popup
 * @param container - The container element
 * @param forceShow - If true, always show the popup even if dismissed (for manual icon clicks)
 */
export function openTotpPopup(input: HTMLInputElement, container: HTMLElement, forceShow: boolean = false) : void {
  createLoadingPopup(input, '', container);

  /**
   * Handle the Enter key.
   */
  const handleEnterKey = (e: KeyboardEvent) : void => {
    if (e.key === 'Enter') {
      removeExistingPopup(container);
      document.body.removeEventListener('keydown', handleEnterKey);
    }
  };

  document.addEventListener('keydown', handleEnterKey);

  (async () : Promise<void> => {
    const currentUrl = getCurrentAutofillFrameUrl();
    if (!currentUrl) {
      removeExistingPopup(container);
      document.removeEventListener('keydown', handleEnterKey);
      return;
    }

    const matchingMode = await LocalPreferencesService.getAutofillMatchingMode();

    const response = await sendMessage('GET_ITEMS_WITH_TOTP', {
      currentUrl,
      pageTitle: document.title,
      matchingMode: matchingMode
    });

    if (response.success) {
      await createTotpPopup(input, response.items, container, response.recentlySelectedId);
    } else {
      // Check if the user has dismissed the vault locked popup (only for auto-show, not manual clicks)
      if (!forceShow) {
        const dismissUntil = await LocalPreferencesService.getVaultLockedDismissUntil();
        if (dismissUntil && Date.now() < dismissUntil) {
          // User has dismissed the popup, don't show it again
          removeExistingPopup(container);
          return;
        }
      }

      await createVaultLockedPopup(input, container);
    }
  })();
}

/**
 * Create TOTP autofill popup showing items with 2FA codes.
 * Matches the styling of the regular autofill popup.
 */
async function createTotpPopup(input: HTMLInputElement, items: Item[] | undefined, rootContainer: HTMLElement, recentlySelectedId?: string | null) : Promise<void> {
  const searchPlaceholder = await t('content.searchVault');
  const hideFor1HourText = await t('content.hideFor1Hour');
  const hidePermanentlyText = await t('content.hidePermanently');
  const noTotpItemsText = await t('content.noTotpItemsFound');

  const popup = createBasePopup(input, rootContainer);

  // Create credential list container with ID
  const credentialList = document.createElement('div');
  credentialList.id = 'aliasvault-credential-list';
  credentialList.className = 'av-credential-list';
  popup.appendChild(credentialList);

  // Add initial items
  if (!items) {
    items = [];
  }

  updateTotpPopupContent(items, credentialList, input, rootContainer, noTotpItemsText, recentlySelectedId);

  // Add divider
  const divider = document.createElement('div');
  divider.className = 'av-divider';
  popup.appendChild(divider);

  // Add action buttons container (matches regular autofill popup)
  const actionContainer = document.createElement('div');
  actionContainer.className = 'av-action-container';

  // Create search input with native placeholder
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = searchPlaceholder;
  searchInput.dataset.avDisable = 'true';
  searchInput.id = 'aliasvault-search-input';
  searchInput.className = 'av-search-input';

  // Handle search input - search only TOTP items
  let searchTimeout: NodeJS.Timeout | null = null;
  searchInput.addEventListener('input', async () => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    const searchTerm = searchInput.value.trim();

    if (searchTerm === '') {
      // If search is empty, show the initially URL-filtered items
      updateTotpPopupContent(items, credentialList, input, rootContainer, noTotpItemsText, recentlySelectedId);
    } else {
      // Search in TOTP items only
      const response = await sendMessage('SEARCH_ITEMS_WITH_TOTP', {
        searchTerm: searchTerm
      });

      if (response.success && response.items) {
        // Search results don't carry prioritization, so don't highlight any item
        updateTotpPopupContent(response.items, credentialList, input, rootContainer, noTotpItemsText);
      } else {
        // On error, fallback to showing initial filtered items
        updateTotpPopupContent(items, credentialList, input, rootContainer, noTotpItemsText, recentlySelectedId);
      }
    }
  });

  // Close button (matches regular autofill popup)
  const closeButton = document.createElement('button');
  closeButton.className = 'av-button av-button-close';
  closeButton.innerHTML = `
    <svg class="av-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  /**
   * Handle close button click - show context menu for hide options
   */
  const handleCloseClick = (e: Event): void => {
    e.stopPropagation();
    const rect = closeButton.getBoundingClientRect();
    const contextMenu = document.createElement('div');
    contextMenu.className = 'av-context-menu';
    contextMenu.style.position = 'fixed';
    contextMenu.style.left = `${rect.left}px`;
    contextMenu.style.top = `${rect.bottom + 4}px`;
    contextMenu.innerHTML = `
      <button class="av-context-menu-item" data-action="temporary">
        <svg class="av-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        ${hideFor1HourText}
      </button>
      <button class="av-context-menu-item" data-action="permanent">
        <svg class="av-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        ${hidePermanentlyText}
      </button>
    `;

    // Remove any existing context menu
    const existingMenu = document.querySelector('.av-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    // Add the new context menu
    popup.appendChild(contextMenu);

    /**
     * Handle clicks on context menu items
     */
    const handleContextMenuClick = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const target = e.target as HTMLElement;
      const menuItem = target.closest('.av-context-menu-item') as HTMLElement;
      if (!menuItem) {
        // Clicked outside the menu, close everything
        contextMenu.remove();
        removeExistingPopup(rootContainer);
        document.removeEventListener('click', handleContextMenuClick);
        return;
      }

      const action = menuItem.dataset.action;
      if (action === 'temporary') {
        disableAutoShowPopup(true);
      } else if (action === 'permanent') {
        disableAutoShowPopup(false);
      }
      contextMenu.remove();
      removeExistingPopup(rootContainer);
      document.removeEventListener('click', handleContextMenuClick);
    };

    // Add click listener to handle menu item clicks
    addReliableClickHandler(contextMenu, handleContextMenuClick);
  };

  // Add click handlers with security validation
  addReliableClickHandler(closeButton, (e: Event) => {
    handleCloseClick(e);
  });

  actionContainer.appendChild(searchInput);
  actionContainer.appendChild(closeButton);
  popup.appendChild(actionContainer);

  /**
   * Handle clicking outside the popup.
   */
  const handleClickOutside = (event: MouseEvent) : void => {
    const popupElement = rootContainer.querySelector('#aliasvault-credential-popup');
    // If popup doesn't exist, remove the listener
    if (!popupElement) {
      document.removeEventListener('mousedown', handleClickOutside);
      return;
    }

    // Check if the click is outside the popup and outside the input/icon UI.
    if (!isClickInsidePopupUi(event, popupElement, input)) {
      removeExistingPopup(rootContainer);
    }
  };

  // Add the event listener for clicking outside
  document.addEventListener('mousedown', handleClickOutside);
  rootContainer.appendChild(popup);
}

/**
 * Update the TOTP item list content in the popup with live code preview.
 *
 * @param items - The items to display.
 * @param itemList - The item list element.
 * @param input - The input element that triggered the popup.
 * @param rootContainer - The root container element.
 * @param noMatchesText - Text to show when no items match.
 */
function updateTotpPopupContent(items: Item[], itemList: HTMLElement | null, input: HTMLInputElement, rootContainer: HTMLElement, noMatchesText?: string, recentlySelectedId?: string | null) : void {
  if (!itemList) {
    itemList = document.getElementById('aliasvault-credential-list') as HTMLElement;
  }

  if (!itemList) {
    return;
  }

  // Cleanup any existing interval before creating new items
  cleanupTotpInterval();

  // Clear existing content
  itemList.innerHTML = '';

  if (items.length === 0) {
    const noMatches = document.createElement('div');
    noMatches.className = 'av-no-matches';
    noMatches.textContent = noMatchesText || 'No credentials with 2FA codes found';
    itemList.appendChild(noMatches);
    return;
  }

  // Fetch TOTP secrets and create items with live codes
  (async (): Promise<void> => {
    const itemIds = items.map(item => item.Id);
    const secretsResponse = await sendMessage('GET_TOTP_SECRETS', { itemIds });

    const secrets = secretsResponse.success && secretsResponse.secrets ? secretsResponse.secrets : {};
    const hasSecrets = Object.keys(secrets).length > 0;

    // Create items (with live codes if secrets available, static otherwise)
    const codeElements: Map<string, { codeSpan: HTMLSpanElement; pieChart: SVGPathElement }> = new Map();

    items.forEach(item => {
      const secret = secrets[item.Id];
      const isRecentlySelected = recentlySelectedId != null && item.Id === recentlySelectedId;
      const itemElement = createTotpItem(item, secret, input, rootContainer, hasSecrets ? codeElements : undefined, isRecentlySelected);
      itemList!.appendChild(itemElement);
    });

    // Set up live updates only if we have secrets
    if (hasSecrets) {
      // Initial update
      updateTotpCodes(codeElements, secrets);

      // Set up interval to update codes every second
      totpUpdateIntervalId = setInterval(() => {
        updateTotpCodes(codeElements, secrets);
      }, 1000);
    }
  })();
}

/**
 * Create SVG path for a pie slice starting from top, going counter-clockwise.
 * @param cx - Center X
 * @param cy - Center Y
 * @param r - Radius
 * @param fraction - Fraction of the pie to show (0 to 1)
 */
function createPieSlicePath(cx: number, cy: number, r: number, fraction: number): string {
  if (fraction <= 0) {
    return '';
  }
  if (fraction >= 1) {
    return `M ${cx},${cy} m 0,-${r} a ${r},${r} 0 1,0 0,${r * 2} a ${r},${r} 0 1,0 0,-${r * 2} Z`;
  }

  const angle = fraction * 2 * Math.PI;
  // Start from top (12 o'clock position)
  const startX = cx;
  const startY = cy - r;
  // End point going counter-clockwise
  const endX = cx - r * Math.sin(angle);
  const endY = cy - r * Math.cos(angle);
  // Large arc flag: 1 if angle > 180 degrees
  const largeArc = fraction > 0.5 ? 1 : 0;

  return `M ${cx},${cy} L ${startX},${startY} A ${r},${r} 0 ${largeArc},0 ${endX},${endY} Z`;
}

/**
 * Update TOTP codes and pie chart countdown for all items.
 */
function updateTotpCodes(
  codeElements: Map<string, { codeSpan: HTMLSpanElement; pieChart: SVGPathElement }>,
  secrets: Record<string, string>
): void {
  const remainingSeconds = getTotpRemainingSeconds();
  const fraction = remainingSeconds / 30;

  codeElements.forEach((elements, itemId) => {
    const secret = secrets[itemId];
    if (secret) {
      elements.codeSpan.textContent = generateTotpCode(secret);
    }
    elements.pieChart.setAttribute('d', createPieSlicePath(6, 6, 5, fraction));
  });
}

/**
 * Create a TOTP item element.
 * If secret is provided, shows live code with pie chart countdown.
 * If secret is undefined, shows static "000 000" placeholder.
 */
function createTotpItem(
  item: Item,
  secret: string | undefined,
  input: HTMLInputElement,
  rootContainer: HTMLElement,
  codeElements?: Map<string, { codeSpan: HTMLSpanElement; pieChart: SVGPathElement }>,
  isRecentlySelected: boolean = false
): HTMLElement {
  const itemElement = document.createElement('div');
  itemElement.className = 'av-credential-item';

  // Create container for item info (logo + name)
  const itemInfo = document.createElement('div');
  itemInfo.className = 'av-credential-info';

  itemInfo.appendChild(createLogoContainer(item.Logo));

  const itemTextContainer = document.createElement('div');
  itemTextContainer.className = 'av-credential-text';

  // Service name (primary text) with optional "recently used" indicator
  const serviceName = document.createElement('div');
  serviceName.className = 'av-service-name';

  if (isRecentlySelected) {
    const serviceNameContainer = document.createElement('div');
    serviceNameContainer.style.display = 'flex';
    serviceNameContainer.style.alignItems = 'center';
    serviceNameContainer.style.gap = '4px';

    const serviceNameText = document.createElement('span');
    serviceNameText.textContent = item.Name || '';
    serviceNameContainer.appendChild(serviceNameText);
    serviceNameContainer.appendChild(createRecentlySelectedIcon());

    serviceName.appendChild(serviceNameContainer);
  } else {
    serviceName.textContent = item.Name || '';
  }

  // TOTP code display beneath title (like username in normal credentials)
  const detailsContainer = document.createElement('div');
  detailsContainer.className = 'av-service-details';
  detailsContainer.style.display = 'flex';
  detailsContainer.style.alignItems = 'center';
  detailsContainer.style.gap = '6px';

  // TOTP code span - show generated code or static placeholder
  const codeSpan = document.createElement('span');
  codeSpan.textContent = secret ? generateTotpCode(secret) : '000 000';

  // Pie chart countdown - blue pie that shrinks clockwise from top
  const remainingSeconds = getTotpRemainingSeconds();
  const fraction = secret ? remainingSeconds / 30 : 1; // Static shows full pie

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.style.flexShrink = '0';

  // Blue pie slice that shrinks clockwise from top (like a clock)
  const pieChart = document.createElementNS(svgNS, 'path');
  pieChart.setAttribute('fill', secret ? '#3b82f6' : '#9ca3af'); // Gray for static
  pieChart.setAttribute('d', createPieSlicePath(6, 6, 5, fraction));

  svg.appendChild(pieChart);

  detailsContainer.appendChild(codeSpan);
  detailsContainer.appendChild(svg);

  itemTextContainer.appendChild(serviceName);
  itemTextContainer.appendChild(detailsContainer);
  itemInfo.appendChild(itemTextContainer);

  // Store references for live updates (only if secret exists and codeElements provided)
  if (secret && codeElements) {
    codeElements.set(item.Id, { codeSpan, pieChart });
  }

  itemElement.appendChild(itemInfo);
  itemElement.appendChild(createPopoutIcon(item.Id, rootContainer));

  // Handle click to fill TOTP code
  addReliableClickHandler(itemInfo, async () => {
    await fillTotpCode(item.Id, input);
    removeExistingPopup(rootContainer);
  });

  return itemElement;
}

/**
 * Create basic popup with default style.
 */
export function createBasePopup(input: HTMLInputElement, rootContainer: HTMLElement) : HTMLElement {
  // Remove existing popup and its event listeners
  removeExistingPopup(rootContainer);

  const popup = document.createElement('div');
  popup.id = 'aliasvault-credential-popup';
  popup.className = 'av-popup';

  // Get position of the input field relative to the viewport
  const inputRect = input.getBoundingClientRect();

  // Get position of the root container relative to the viewport
  const rootContainerRect = rootContainer.getBoundingClientRect();

  /*
   * Calculate the position relative to the root container.
   * The shadow container should be fixed at top:0, left:0, so we can use
   * viewport-relative coordinates directly.
   *
   * If the rootContainer is unexpectedly positioned due to client-side
   * modifications like ad-blockers, fall back to using
   * fixed positioning relative to viewport.
   */
  let relativeTop = inputRect.bottom - rootContainerRect.top;
  let relativeLeft = inputRect.left - rootContainerRect.left;
  let useFixedPositioning = false;

  // If the container is not at top-left (within tolerance), use fixed positioning
  if (Math.abs(rootContainerRect.top) > 10 || Math.abs(rootContainerRect.left) > 10) {
    useFixedPositioning = true;
    relativeTop = inputRect.bottom;
    relativeLeft = inputRect.left;
  }

  // Set the position
  popup.style.position = useFixedPositioning ? 'fixed' : 'absolute';
  popup.style.top = `${relativeTop}px`;
  popup.style.left = `${relativeLeft}px`;

  // Append popup to the root container
  rootContainer.appendChild(popup);

  /*
   * Some websites embed the login form inside an iframe. We constrain the popup to 
   * the (i)frame viewport so it doesn't get clipped inside small iframes.
   * Instead, this will allow the popup to scroll internally if needed.
   */
  requestAnimationFrame(() => {
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const margin = 8;
    const spaceBelow = viewportHeight - inputRect.bottom - margin;
    const spaceAbove = inputRect.top - margin;

    let availableHeight = spaceBelow;
    if (spaceBelow < 160 && spaceAbove > spaceBelow) {
      // Flip above the input
      const popupHeight = popup.offsetHeight;
      const constrainedHeight = Math.min(popupHeight, spaceAbove);
      const newTop = useFixedPositioning
        ? inputRect.top - constrainedHeight - 4
        : inputRect.top - rootContainerRect.top - constrainedHeight - 4;
      popup.style.top = `${newTop}px`;
      availableHeight = spaceAbove;
    }

    popup.style.maxHeight = `${Math.max(80, availableHeight)}px`;
    popup.style.overflowY = 'auto';

    // Clamp horizontally so the popup stays inside the viewport
    const popupWidth = popup.offsetWidth;
    if (inputRect.left + popupWidth > viewportWidth - margin) {
      const newLeft = Math.max(margin, viewportWidth - popupWidth - margin);
      popup.style.left = useFixedPositioning
        ? `${newLeft}px`
        : `${newLeft - rootContainerRect.left}px`;
    }
  });

  return popup;
}

/**
 * Create a loading popup.
 */
export function createLoadingPopup(input: HTMLInputElement, message: string, rootContainer: HTMLElement) : HTMLElement {
  /**
   * Get the loading wrapper HTML.
   */
  const getLoadingHtml = (message: string): string => `
    <div class="av-loading-container">
      <div class="av-loading-spinner"></div>
      <span class="av-loading-text">${message}</span>
    </div>
  `;

  const popup = createBasePopup(input, rootContainer);
  popup.innerHTML = getLoadingHtml(message);

  rootContainer.appendChild(popup);
  return popup;
}

/**
 * Update the item list content in the popup.
 *
 * @param items - The items to display.
 * @param itemList - The item list element.
 * @param input - The input element that triggered the popup. Required when filling items to know which form to fill.
 */
export async function updatePopupContent(items: Item[], itemList: HTMLElement | null, input: HTMLInputElement, rootContainer: HTMLElement, noMatchesText?: string, recentlySelectedId?: string | null) : Promise<void> {
  if (!itemList) {
    itemList = document.getElementById('aliasvault-credential-list') as HTMLElement;
  }

  if (!itemList) {
    return;
  }

  // Clear existing content
  itemList.innerHTML = '';

  // Add items using the shared function
  const itemElements = createItemList(items, input, rootContainer, noMatchesText, recentlySelectedId);
  itemElements.forEach(element => itemList.appendChild(element));
}

/**
 * Build a small history-arrow SVG badge indicating this item was the most recently
 * autofilled on this site, so the user can quickly spot it among multiple matches.
 */
function createRecentlySelectedIcon(): SVGSVGElement {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', '#6b7280');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.width = '12px';
  svg.style.height = '12px';
  svg.style.flexShrink = '0';

  const arc = document.createElementNS(svgNS, 'path');
  arc.setAttribute('d', 'M3 12a9 9 0 1 0 9-9 9.74 9.74 0 0 0-6.74 2.74L3 8');
  svg.appendChild(arc);

  const corner = document.createElementNS(svgNS, 'polyline');
  corner.setAttribute('points', '3 3 3 8 8 8');
  svg.appendChild(corner);

  const innerHands = document.createElementNS(svgNS, 'path');
  innerHands.setAttribute('d', 'M12 7v5l4 2');
  svg.appendChild(innerHands);

  return svg;
}

/**
 * Remove existing popup (if any exists).
 */
export function removeExistingPopup(container: HTMLElement) : void {
  const existingInContainer = container.querySelector('#aliasvault-credential-popup');

  if (existingInContainer) {
    // Remove event listeners before removing the element
    if (popupListeners && popupListeners.has(container)) {
      const listener = popupListeners.get(container);
      if (listener) {
        container.removeEventListener('mousedown', listener);
        popupListeners.delete(container);
      }
    }

    // Cleanup TOTP interval
    cleanupTotpInterval();

    existingInContainer.remove();
  }
}

/**
 * Whether an item is usable for autofill: it must carry at least a username, email, or
 * password. Items with none of these (e.g. a note-only entry) can't fill a login form, so
 * showing them as a credential match is just noise.
 */
function hasFillableLoginField(item: Item): boolean {
  return [FieldKey.LoginUsername, FieldKey.LoginEmail, FieldKey.LoginPassword]
    .some((key) => (getFieldValue(item, key) ?? '').trim() !== '');
}

/**
 * Create auto-fill popup
 */
export async function createAutofillPopup(input: HTMLInputElement, items: Item[] | undefined, rootContainer: HTMLElement, recentlySelectedId?: string | null) : Promise<void> {
  // Remember the input so a credential created in the full popup window can be filled back here.
  lastAutofillInput = input;

  // Get all translations first
  const newText = await t('content.new');
  const searchPlaceholder = await t('content.searchVault');
  const hideFor1HourText = await t('content.hideFor1Hour');
  const hidePermanentlyText = await t('content.hidePermanently');
  const noMatchesText = await t('content.noMatchesFound');

  const popup = createBasePopup(input, rootContainer);

  /*
   * Conditional passkey autofill: when a page has a pending conditional get() request and we
   * hold matching passkeys, the popup gains a persistent pill nav switching between a passkey
   * view and the credential view.
   */
  const passkeySection = await createPasskeySection(rootContainer);

  // Create credential list container with ID
  const credentialList = document.createElement('div');
  credentialList.id = 'aliasvault-credential-list';
  credentialList.className = 'av-credential-list';
  popup.appendChild(credentialList);

  // Add initial items (already filtered by background script for performance)
  if (!items) {
    items = [];
  }

  // Drop entries that have nothing to fill (no username/email/password) - they're not useful matches.
  items = items.filter(hasFillableLoginField);

  await updatePopupContent(items, credentialList, input, rootContainer, noMatchesText, recentlySelectedId);

  // Add divider
  const divider = document.createElement('div');
  divider.className = 'av-divider';
  popup.appendChild(divider);

  // Add action buttons container
  const actionContainer = document.createElement('div');
  actionContainer.className = 'av-action-container';

  // Create New button
  const createButton = document.createElement('button');
  createButton.className = 'av-button av-button-primary';
  createButton.innerHTML = `
    <svg class="av-icon" viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
    ${newText}
  `;

  /**
   * Handle create button click: open the full create-item popup (defaults to Login) prefilled with
   * the detected service name + page URL. The user can switch to an Alias (or any type) there using
   * the normal UI, and the created credential is autofilled back into this page on save.
   */
  const handleCreateClick = (e: Event) : void => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Ensure the field has a stable id so the created credential can be filled back into it.
    if (!input.id) {
      input.id = `aliasvault-input-${Math.random().toString(36).substring(2, 11)}`;
    }

    /*
     * Position the create-credential window near the click so it opens in the user's line of focus
     * instead of the screen corner. Mouse screen coordinates are clamped so the whole window stays
     * on-screen; falls back to the browser default when no pointer position is available (keyboard).
     */
    const position = getCreatePopupPosition(e);

    const serviceInfo = ServiceDetectionUtility.getServiceInfo(document, window.location);
    sendMessage('OPEN_POPUP_CREATE_CREDENTIAL', {
      itemTitle: serviceInfo.suggestedNames[0] || '',
      currentUrl: serviceInfo.currentUrl,
      elementIdentifier: input.id,
      left: position?.left,
      top: position?.top
    });

    removeExistingPopup(rootContainer);
  };

  // Add click listener with capture and prevent removal and security validation.
  addReliableClickHandler(createButton, handleCreateClick);

  // Create search input with native placeholder.
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = searchPlaceholder;
  searchInput.dataset.avDisable = 'true';
  searchInput.id = 'aliasvault-search-input';
  searchInput.className = 'av-search-input';

  // Handle search input.
  let searchTimeout: NodeJS.Timeout | null = null;
  searchInput.addEventListener('input', async () => {
    await handleSearchInput(searchInput, items, rootContainer, searchTimeout, credentialList, input, noMatchesText, recentlySelectedId);
  });

  // Close button
  const closeButton = document.createElement('button');
  closeButton.className = 'av-button av-button-close';
  closeButton.innerHTML = `
    <svg class="av-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  /**
   * Handle close button click
   */
  const handleCloseClick = (e: Event): void => {
    e.stopPropagation();
    const rect = closeButton.getBoundingClientRect();
    const contextMenu = document.createElement('div');
    contextMenu.className = 'av-context-menu';
    contextMenu.style.position = 'fixed';
    contextMenu.style.left = `${rect.left}px`;
    contextMenu.style.top = `${rect.bottom + 4}px`;
    contextMenu.innerHTML = `
      <button class="av-context-menu-item" data-action="temporary">
        <svg class="av-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        ${hideFor1HourText}
      </button>
      <button class="av-context-menu-item" data-action="permanent">
        <svg class="av-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        ${hidePermanentlyText}
      </button>
    `;

    // Remove any existing context menu
    const existingMenu = document.querySelector('.av-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    // Add the new context menu
    popup.appendChild(contextMenu);

    /**
     * Handle clicks on context menu items
     * @param e - The click event
     */
    const handleContextMenuClick = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const target = e.target as HTMLElement;
      const menuItem = target.closest('.av-context-menu-item') as HTMLElement;
      if (!menuItem) {
        // Clicked outside the menu, close everything
        contextMenu.remove();
        removeExistingPopup(rootContainer);
        document.removeEventListener('click', handleContextMenuClick);
        return;
      }

      const action = menuItem.dataset.action;
      if (action === 'temporary') {
        disableAutoShowPopup(true);
      } else if (action === 'permanent') {
        disableAutoShowPopup(false);
      }
      contextMenu.remove();
      removeExistingPopup(rootContainer);
      document.removeEventListener('click', handleContextMenuClick);
    };

    // Add click listener to handle menu item clicks
    addReliableClickHandler(contextMenu, handleContextMenuClick);
  };

  // Add click handlers with security validation
  addReliableClickHandler(closeButton, (e: Event) => {
    handleCloseClick(e);
  });

  actionContainer.appendChild(searchInput);
  actionContainer.appendChild(createButton);
  actionContainer.appendChild(closeButton);
  popup.appendChild(actionContainer);

  /*
   * When passkeys are offered, show the pill nav and the passkey section.
   */
  if (passkeySection) {
    const credentialsText = await t('common.credentials');
    const passkeysText = await t('common.passkeys');
    const credentialsLabel = items.length > 0 ? `${credentialsText} (${items.length})` : credentialsText;
    const passkeysLabel = `${passkeysText} (${passkeySection.count})`;

    // Build the segmented pill nav and pin it to the very top of the popup.
    const pillNav = document.createElement('div');
    pillNav.className = 'av-pill-nav';
    const passkeysPill = createViewSwitchPill(passkeysLabel);
    const credentialsPill = createViewSwitchPill(credentialsLabel);
    pillNav.appendChild(passkeysPill);
    pillNav.appendChild(credentialsPill);
    popup.insertBefore(pillNav, popup.firstChild);
    popup.insertBefore(passkeySection.list, credentialList);

    const whenPasskeysShown = [passkeySection.list];
    const whenCredentialsShown = [credentialList, divider, actionContainer];
    let showingPasskeys = true;

    /**
     * Apply the current view: highlight the active pill and show only that view's elements.
     */
    const applyView = (): void => {
      passkeysPill.classList.toggle('av-pill-active', showingPasskeys);
      credentialsPill.classList.toggle('av-pill-active', !showingPasskeys);
      whenPasskeysShown.forEach((element) => {
        element.style.display = showingPasskeys ? '' : 'none';
      });
      whenCredentialsShown.forEach((element) => {
        element.style.display = showingPasskeys ? 'none' : '';
      });
      if (!showingPasskeys) {
        // Focus the search field so the user can immediately filter the revealed list.
        searchInput.focus();
      }
    };

    /**
     * Add click handlers to the pill nav so clicking it selects its view (passkeys or credentials).
     */
    const wirePill = (pill: HTMLElement, selectsPasskeys: boolean): void => {
      pill.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showingPasskeys = selectsPasskeys;
        applyView();
      });
    };
    wirePill(passkeysPill, true);
    wirePill(credentialsPill, false);

    // Default to the passkey view: if the user has a passkey, that's the likely choice.
    applyView();
  }

  /**
   * Handle clicking outside the popup.
   */
  const handleClickOutside = (event: MouseEvent) : void => {
    const popup = rootContainer.querySelector('#aliasvault-credential-popup');
    // If popup doesn't exist, remove the listener
    if (!popup) {
      document.removeEventListener('mousedown', handleClickOutside);
      return;
    }

    // Check if the click is outside the popup and outside the input/icon UI.
    if (!isClickInsidePopupUi(event, popup, input)) {
      removeExistingPopup(rootContainer);
    }
  };

  // Add the event listener for clicking outside
  document.addEventListener('mousedown', handleClickOutside);
  rootContainer.appendChild(popup);
}

/**
 * Create vault locked popup.
 */
export async function createVaultLockedPopup(input: HTMLInputElement, rootContainer: HTMLElement): Promise<void> {
  /**
   * Handle unlock click.
   */
  const handleUnlockClick = () : void => {
    sendMessage('OPEN_POPUP');
    removeExistingPopup(rootContainer);
  }

  const popup = createBasePopup(input, rootContainer);
  popup.classList.add('av-vault-locked');

  // Create container for message and button
  const container = document.createElement('div');
  container.className = 'av-vault-locked-container';

  // Make the entire container clickable with security validation
  addReliableClickHandler(container, handleUnlockClick);
  container.style.cursor = 'pointer';

  // Add message
  const messageElement = document.createElement('div');
  messageElement.className = 'av-vault-locked-message';
  messageElement.textContent = await t('content.vaultLocked');
  container.appendChild(messageElement);

  // Add unlock button with SVG icon
  const button = document.createElement('button');
  button.title = 'Unlock AliasVault';
  button.className = 'av-vault-locked-button';
  button.innerHTML = `
    <svg class="av-icon-lock" viewBox="0 0 24 24">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
    </svg>
  `;
  container.appendChild(button);

  // Add the container to the popup
  popup.appendChild(container);

  // Add close button as a separate element positioned to the right
  const closeButton = document.createElement('button');
  closeButton.className = 'av-button av-button-close av-vault-locked-close';
  closeButton.title = 'Dismiss popup';
  closeButton.innerHTML = `
    <svg class="av-icon" viewBox="0 0 24 24">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

  // Position the close button to the right of the container
  closeButton.style.position = 'absolute';
  closeButton.style.right = '8px';
  closeButton.style.top = '50%';
  closeButton.style.transform = 'translateY(-50%)';

  // Handle close button click with security validation
  addReliableClickHandler(closeButton, async (e) => {
    e.stopPropagation(); // Prevent opening the unlock popup
    await dismissVaultLockedPopup();
    removeExistingPopup(rootContainer);
  });

  popup.appendChild(closeButton);

  /**
   * Add event listener to document to close popup when clicking outside.
   */
  const handleClickOutside = (event: MouseEvent): void => {
    // Check if the click is outside the popup and outside the input/icon UI.
    if (!isClickInsidePopupUi(event, popup, input)) {
      removeExistingPopup(rootContainer);
      document.removeEventListener('mousedown', handleClickOutside);
    }
  };

  setTimeout(() => {
    document.addEventListener('mousedown', handleClickOutside);
  }, 100);

  rootContainer.appendChild(popup);
}

/**
 * Handle popup search input - searches entire vault when user types.
 * When empty, shows the initially URL-filtered items.
 * When user types, searches ALL items in vault (not just the pre-filtered set).
 *
 * @param searchInput - The search input element
 * @param initialItems - The initially URL-filtered items to show when search is empty
 * @param rootContainer - The root container element
 * @param searchTimeout - Timeout for debouncing search
 * @param itemList - The item list element to update
 * @param input - The input field that triggered the popup
 * @param noMatchesText - Text to show when no matches found
 */
async function handleSearchInput(searchInput: HTMLInputElement, initialItems: Item[], rootContainer: HTMLElement, searchTimeout: NodeJS.Timeout | null, itemList: HTMLElement | null, input: HTMLInputElement, noMatchesText?: string, recentlySelectedId?: string | null) : Promise<void> {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  const searchTerm = searchInput.value.trim();

  if (searchTerm === '') {
    // If search is empty, show the initially URL-filtered items with the recently-used star restored
    await updatePopupContent(initialItems, itemList, input, rootContainer, noMatchesText, recentlySelectedId);
  } else {
    // Search in full vault with search term
    const response = await sendMessage('GET_SEARCH_ITEMS', {
      searchTerm: searchTerm
    });

    if (response.success && response.items) {
      // Search results don't carry prioritization, so don't highlight any item
      const fillableItems = response.items.filter(hasFillableLoginField);
      await updatePopupContent(fillableItems, itemList, input, rootContainer, noMatchesText);
    } else {
      // On error, fallback to showing initial filtered items
      await updatePopupContent(initialItems, itemList, input, rootContainer, noMatchesText, recentlySelectedId);
    }
  }
}

/**
 * Build small passkey badge icon shown next to a service name to mark that the entry is (or has) a passkey.
 */
function createPasskeyBadgeIcon(): SVGSVGElement {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'av-passkey-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-label', 'Has passkey');
  svg.style.width = '14px';
  svg.style.height = '14px';
  svg.style.flexShrink = '0';
  svg.style.opacity = '0.7';

  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4');
  svg.appendChild(path);

  return svg;
}

/**
 * Build logo box for a credential/passkey/TOTP row: the item's favicon when present, otherwise the generic placeholder icon.
 */
function createLogoContainer(logo: Uint8Array | number[] | undefined): HTMLElement {
  const logoContainer = document.createElement('div');
  logoContainer.className = 'av-credential-logo';

  const logoSrc = SqliteClient.imgSrcFromBytes(logo);
  if (logoSrc) {
    logoContainer.innerHTML = `<img src="${logoSrc}" alt="" style="width:100%;height:100%;">`;
  } else {
    logoContainer.innerHTML = ItemTypeIconSvgs.Placeholder;
  }

  return logoContainer;
}

/**
 * Build popout icon shown at the trailing edge of a row, which opens the underlying item in the full extension popup.
 */
function createPopoutIcon(itemId: string, rootContainer: HTMLElement): HTMLElement {
  const popoutIcon = document.createElement('div');
  popoutIcon.className = 'av-popout-icon';
  popoutIcon.innerHTML = `
      <svg class="av-icon" viewBox="0 0 24 24">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
      </svg>
    `;

  addReliableClickHandler(popoutIcon, (e) => {
    e.stopPropagation(); // Don't trigger the row's primary action.
    sendMessage('OPEN_POPUP_WITH_ITEM', { itemId });
    removeExistingPopup(rootContainer);
  });

  return popoutIcon;
}

/**
 * Build passkey side of the autofill popup: a short hint line that makes the passkey view 
 * recognisably different from the credential view, the scrollable list of passkey sign-in rows, 
 * and the passkey count (for the pill-nav label).
 */
async function createPasskeySection(rootContainer: HTMLElement): Promise<{ list: HTMLElement; count: number } | null> {
  if (!hasPendingConditionalRequest()) {
    return null;
  }

  const options = getConditionalPasskeyOptions();
  if (options.length === 0) {
    return null;
  }

  /*
   * Reuse the credential-list scroll styling but cap the height so at most ~3 passkeys are
   * visible before the list scrolls, leaving room for the view-switch toggle below.
   */
  const list = document.createElement('div');
  list.className = 'av-credential-list av-passkey-list';

  /*
   * Hint caption as the first row inside the scroll area, so it scrolls away with the list.
   */
  const hint = document.createElement('div');
  hint.className = 'av-passkey-hint';
  hint.textContent = await t('content.loginWithPasskey');
  list.appendChild(hint);

  options.forEach((option) => {
    const itemElement = document.createElement('div');
    itemElement.className = 'av-credential-item';

    const itemInfo = document.createElement('div');
    itemInfo.className = 'av-credential-info';

    // Show the credential's favicon (matching the normal rows), falling back to a placeholder.
    itemInfo.appendChild(createLogoContainer(option.logo ?? undefined));

    const textContainer = document.createElement('div');
    textContainer.className = 'av-credential-text';

    // Service name with a passkey badge so the row is recognisable as a passkey sign-in.
    const serviceName = document.createElement('div');
    serviceName.className = 'av-service-name';
    const serviceNameContainer = document.createElement('div');
    serviceNameContainer.style.display = 'flex';
    serviceNameContainer.style.alignItems = 'center';
    serviceNameContainer.style.gap = '4px';
    const serviceNameText = document.createElement('span');
    serviceNameText.textContent = option.serviceName;
    serviceNameContainer.appendChild(serviceNameText);
    serviceNameContainer.appendChild(createPasskeyBadgeIcon());
    serviceName.appendChild(serviceNameContainer);
    textContainer.appendChild(serviceName);

    if (option.username) {
      const details = document.createElement('div');
      details.className = 'av-service-details';
      details.textContent = option.username;
      textContainer.appendChild(details);
    }

    itemInfo.appendChild(textContainer);
    itemElement.appendChild(itemInfo);

    // Popout icon opens the underlying credential in the full extension popup.
    itemElement.appendChild(createPopoutIcon(option.itemId, rootContainer));

    addReliableClickHandler(itemInfo, () => {
      // Explicit user action - keep the vault from auto-locking mid-assertion.
      sendMessage('RESET_AUTO_LOCK_TIMER').catch(() => {
        // Ignore: background may be asleep.
      });
      void completeConditionalWithPasskey(option.id);
      removeExistingPopup(rootContainer);
    });

    list.appendChild(itemElement);
  });

  return { list, count: options.length };
}

/**
 * Build a single segment button for the passkey/credentials pill nav shown at the top of the
 * autofill popup when conditional passkeys are offered (e.g. "Passkeys (2)" or
 * "Credentials (3)"). The caller marks the active segment via the `av-pill-active` class.
 *
 * @param label - The segment text, including the match count.
 */
function createViewSwitchPill(label: string): HTMLButtonElement {
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'av-pill';
  pill.textContent = label;
  return pill;
}

/**
 * Create item list content for popup
 *
 * @param items - The items to display.
 * @param input - The input element that triggered the popup. Required when filling items to know which form to fill.
 */
function createItemList(items: Item[], input: HTMLInputElement, rootContainer: HTMLElement, noMatchesText?: string, recentlySelectedId?: string | null): HTMLElement[] {
  const elements: HTMLElement[] = [];

  if (items.length > 0) {
    items.forEach((item) => {
      const itemElement = document.createElement('div');
      itemElement.className = 'av-credential-item';

      // Create container for item info (logo + username)
      const itemInfo = document.createElement('div');
      itemInfo.className = 'av-credential-info';

      itemInfo.appendChild(createLogoContainer(item.Logo));
      const itemTextContainer = document.createElement('div');
      itemTextContainer.className = 'av-credential-text';

      // Service name (primary text) with passkey indicator
      const serviceName = document.createElement('div');
      serviceName.className = 'av-service-name';

      // Create a flex container for service name and passkey icon
      const serviceNameContainer = document.createElement('div');
      serviceNameContainer.style.display = 'flex';
      serviceNameContainer.style.alignItems = 'center';
      serviceNameContainer.style.gap = '4px';

      const serviceNameText = document.createElement('span');
      serviceNameText.textContent = item.Name || '';
      serviceNameContainer.appendChild(serviceNameText);

      // Add "recently used" indicator if this item was the last autofill on this site
      if (recentlySelectedId != null && item.Id === recentlySelectedId) {
        serviceNameContainer.appendChild(createRecentlySelectedIcon());
      }
      
      serviceName.appendChild(serviceNameContainer);

      // Details container (secondary text) - extract from fields
      const detailsContainer = document.createElement('div');
      detailsContainer.className = 'av-service-details';

      // Get field values using helper function
      const firstName = item.Fields.find(f => f.FieldKey === FieldKey.AliasFirstName)?.Value;
      const lastName = item.Fields.find(f => f.FieldKey === FieldKey.AliasLastName)?.Value;
      const username = item.Fields.find(f => f.FieldKey === FieldKey.LoginUsername)?.Value;
      const email = item.Fields.find(f => f.FieldKey === FieldKey.LoginEmail)?.Value;

      // Combine full name (if available) and username or email
      const details: string[] = [];
      const firstNameStr = Array.isArray(firstName) ? firstName[0] : firstName;
      const lastNameStr = Array.isArray(lastName) ? lastName[0] : lastName;
      const usernameStr = Array.isArray(username) ? username[0] : username;
      const emailStr = Array.isArray(email) ? email[0] : email;

      if (firstNameStr && lastNameStr) {
        details.push(`${firstNameStr} ${lastNameStr}`);
      }
      if (usernameStr) {
        details.push(usernameStr);
      } else if (emailStr) {
        details.push(emailStr);
      }
      detailsContainer.textContent = details.join(' · ');

      itemTextContainer.appendChild(serviceName);
      itemTextContainer.appendChild(detailsContainer);
      itemInfo.appendChild(itemTextContainer);

      itemElement.appendChild(itemInfo);
      itemElement.appendChild(createPopoutIcon(item.Id, rootContainer));

      // Update click handler to only trigger on itemInfo with security validation
      addReliableClickHandler(itemInfo, () => {
        fillItem(item, input);
        removeExistingPopup(rootContainer);
      });

      elements.push(itemElement);
    });
  } else {
    const noMatches = document.createElement('div');
    noMatches.className = 'av-no-matches';
    noMatches.textContent = noMatchesText || 'No matches found';
    elements.push(noMatches);
  }

  return elements;
}

/**
 * Check if auto-popup is disabled for current site
 */
/**
 * Disable auto-popup for current site
 */
export async function disableAutoShowPopup(temporary: boolean = false): Promise<void> {
  const currentHostname = window.location.hostname;

  if (temporary) {
    // Add to temporary disabled sites with 1 hour expiry
    const temporaryDisabledSites = await LocalPreferencesService.getTemporaryDisabledSites();
    temporaryDisabledSites[currentHostname] = Date.now() + (60 * 60 * 1000); // 1 hour from now
    await LocalPreferencesService.setTemporaryDisabledSites(temporaryDisabledSites);
  } else {
    // Add to permanently disabled sites
    const disabledSites = await LocalPreferencesService.getDisabledSites();
    if (!disabledSites.includes(currentHostname)) {
      disabledSites.push(currentHostname);
      await LocalPreferencesService.setDisabledSites(disabledSites);
    }
  }
}

/**
 * Dismiss vault locked popup for 4 hours if user is logged in, or for 3 days if user is not logged in.
 */
export async function dismissVaultLockedPopup(): Promise<void> {
  // First check if user is logged in or not.
  const authStatus = await sendMessage('CHECK_AUTH_STATUS');

  if (authStatus.isLoggedIn) {
    // User is logged in - dismiss for 4 hours
    const fourHoursFromNow = Date.now() + (4 * 60 * 60 * 1000);
    await LocalPreferencesService.setVaultLockedDismissUntil(fourHoursFromNow);
  } else {
    // User is not logged in - dismiss for 3 days
    const threeDaysFromNow = Date.now() + (3 * 24 * 60 * 60 * 1000);
    await LocalPreferencesService.setVaultLockedDismissUntil(threeDaysFromNow);
  }
}

/**
 * Add click handler with mousedown/mouseup backup for better click reliability in shadow DOM.
 * Now includes optional security validation.
 *
 * Some websites due to their design cause the AliasVault autofill to re-trigger when clicking
 * outside of the input field, which causes the AliasVault popup to close before the click event
 * is registered. This is a workaround to ensure the click event is always registered.
 */
function addReliableClickHandler(
  element: HTMLElement,
  handler: (e: Event) => void
): void {
  /**
   * Secure wrapper that validates clicks before executing handler
   */
  const secureHandler = async (e: Event): Promise<void> => {
    const mouseEvent = e as MouseEvent;

    if (!await clickValidator.validateClick(mouseEvent)) {
      console.warn(`[AliasVault Security] Blocked click action due to security validation failure`);
      return;
    }

    handler(e);
  };

  // Add primary click listener with capture and prevent removal
  element.addEventListener('click', secureHandler, {
    capture: true,
    passive: false
  });

  // Backup click handling using mousedown/mouseup if needed
  let isMouseDown = false;
  element.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isMouseDown = true;
  }, { capture: true });

  element.addEventListener('mouseup', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isMouseDown) {
      await secureHandler(e);
    }
    isMouseDown = false;
  }, { capture: true });
}

/**
 * Create upgrade required popup.
 */
export async function createUpgradeRequiredPopup(input: HTMLInputElement, rootContainer: HTMLElement, errorMessage: string): Promise<void> {
  /**
   * Handle upgrade click.
   */
  const handleUpgradeClick = () : void => {
    sendMessage('OPEN_POPUP');
    removeExistingPopup(rootContainer);
  }

  const popup = createBasePopup(input, rootContainer);
  popup.classList.add('av-upgrade-required');

  // Create container for message and button
  const container = document.createElement('div');
  container.className = 'av-upgrade-required-container';

  addReliableClickHandler(container, handleUpgradeClick);
  container.style.cursor = 'pointer';

  // Add message
  const messageElement = document.createElement('div');
  messageElement.className = 'av-upgrade-required-message';
  messageElement.textContent = errorMessage;
  container.appendChild(messageElement);

  // Add upgrade button with SVG icon
  const button = document.createElement('button');
  button.title = await t('content.openAliasVaultToUpgrade');
  button.className = 'av-upgrade-required-button';
  button.innerHTML = `
    <svg class="av-icon-upgrade" viewBox="0 0 24 24">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
    </svg>
  `;
  container.appendChild(button);

  // Add the container to the popup
  popup.appendChild(container);

  // Add close button as a separate element positioned to the right
  const closeButton = document.createElement('button');
  closeButton.className = 'av-button av-button-close av-upgrade-required-close';
  closeButton.title = await t('content.dismissPopup');
  closeButton.innerHTML = `
    <svg class="av-icon" viewBox="0 0 24 24">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

  // Position the close button to the right of the container
  closeButton.style.position = 'absolute';
  closeButton.style.right = '8px';
  closeButton.style.top = '50%';
  closeButton.style.transform = 'translateY(-50%)';

  // Handle close button click
  addReliableClickHandler(closeButton, (e) => {
    e.stopPropagation(); // Prevent opening the upgrade popup
    removeExistingPopup(rootContainer);
  });

  popup.appendChild(closeButton);

  /**
   * Add event listener to document to close popup when clicking outside.
   */
  const handleClickOutside = (event: MouseEvent): void => {
    // Check if the click is outside the popup and outside the input/icon UI.
    if (!isClickInsidePopupUi(event, popup, input)) {
      removeExistingPopup(rootContainer);
      document.removeEventListener('mousedown', handleClickOutside);
    }
  };

  setTimeout(() => {
    document.addEventListener('mousedown', handleClickOutside);
  }, 100);

  rootContainer.appendChild(popup);
}
