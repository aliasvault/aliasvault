/**
 * Save prompt UI component for offering to save detected login credentials.
 * Displays a non-intrusive banner at the top of the page when credentials are detected.
 */

import { getLogoMarkSvg } from '@/utils/constants/logo';
import type { CapturedLogin, SavePromptOptions } from '@/utils/loginDetector';

import { t } from '@/i18n/StandaloneI18n';

/** Reference to the current save prompt element */
let currentPrompt: HTMLElement | null = null;

/** Auto-dismiss timer */
let autoDismissTimer: number | null = null;

/** Reference to the countdown bar element */
let countdownBar: HTMLElement | null = null;

/** Track if auto-dismiss is paused (user is interacting) */
let isAutoDismissPaused = false;

/** Remaining time when paused */
let remainingTimeMs = 0;

/** Timestamp when countdown started/resumed */
let countdownStartTime = 0;

/** Current auto-dismiss duration */
let currentAutoDismissMs = 0;

/** Initial auto-dismiss duration (for resetting) */
let initialAutoDismissMs = 0;

/** Callback for when auto-dismiss triggers */
let onAutoDismissCallback: (() => void) | null = null;

/** Current login data - can be updated while prompt is visible */
let currentLogin: CapturedLogin | null = null;

/** Current callbacks - stored so we can use them with updated login */
let currentOnSave: ((login: CapturedLogin, serviceName: string) => void) | null = null;

/**
 * Create and show the save prompt banner.
 * @param container - The shadow DOM container to append the prompt to.
 * @param options - Configuration options for the prompt.
 */
export async function showSavePrompt(container: HTMLElement, options: SavePromptOptions): Promise<void> {
  // Remove any existing prompt first
  removeSavePrompt();

  const { login, onSave, onNeverSave, onDismiss, autoDismissMs = 10000 } = options;

  // Store current login and callback so they can be updated
  currentLogin = login;
  currentOnSave = onSave;

  // Create prompt element
  const prompt = document.createElement('div');
  prompt.className = 'av-save-prompt';
  prompt.innerHTML = await createPromptHTML(login);

  // Add to container
  container.appendChild(prompt);
  currentPrompt = prompt;

  // Trigger slide-in animation
  requestAnimationFrame(() => {
    prompt.classList.add('av-save-prompt--visible');
  });

  // Set up auto-dismiss with countdown bar
  if (autoDismissMs > 0) {
    // Initialize countdown state
    initialAutoDismissMs = autoDismissMs;
    currentAutoDismissMs = autoDismissMs;
    remainingTimeMs = autoDismissMs;
    countdownStartTime = Date.now();
    isAutoDismissPaused = false;
    onAutoDismissCallback = onDismiss;

    // Create and start countdown bar animation
    countdownBar = prompt.querySelector('.av-save-prompt__countdown-bar') as HTMLElement;
    startCountdownAnimation(autoDismissMs);

    autoDismissTimer = window.setTimeout(() => {
      removeSavePrompt();
      onDismiss();
    }, autoDismissMs);

    // Set up hover/focus listeners to pause countdown
    setupPauseListeners(prompt);
  }

  // Set up event listeners
  setupEventListeners(prompt, login, onSave, onNeverSave, onDismiss);
}

/**
 * Start the countdown bar animation.
 */
function startCountdownAnimation(durationMs: number): void {
  if (countdownBar) {
    requestAnimationFrame(() => {
      if (countdownBar) {
        countdownBar.style.transition = `width ${durationMs}ms linear`;
        countdownBar.style.width = '0%';
      }
    });
  }
}

/**
 * Pause the countdown (when user hovers or focuses on the prompt).
 */
function pauseCountdown(): void {
  if (isAutoDismissPaused || !autoDismissTimer) {
    return;
  }

  isAutoDismissPaused = true;

  // Calculate remaining time
  const elapsed = Date.now() - countdownStartTime;
  remainingTimeMs = Math.max(0, currentAutoDismissMs - elapsed);

  // Clear the timer
  clearTimeout(autoDismissTimer);
  autoDismissTimer = null;

  // Pause the CSS animation by getting current width and freezing it
  if (countdownBar) {
    const computedStyle = window.getComputedStyle(countdownBar);
    const currentWidth = computedStyle.width;
    countdownBar.style.transition = 'none';
    countdownBar.style.width = currentWidth;
  }
}

/**
 * Resume the countdown (when user stops hovering/focusing).
 */
function resumeCountdown(): void {
  if (!isAutoDismissPaused || remainingTimeMs <= 0) {
    return;
  }

  isAutoDismissPaused = false;
  countdownStartTime = Date.now();
  currentAutoDismissMs = remainingTimeMs;

  // Resume the CSS animation
  startCountdownAnimation(remainingTimeMs);

  // Set new timer for remaining time
  autoDismissTimer = window.setTimeout(() => {
    removeSavePrompt();
    onAutoDismissCallback?.();
  }, remainingTimeMs);
}

/**
 * Reset the countdown timer to the initial duration.
 * Called when new credentials are detected to give user time to review.
 */
function resetCountdown(): void {
  if (initialAutoDismissMs <= 0) {
    return;
  }

  // Clear existing timer
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer);
    autoDismissTimer = null;
  }

  // Reset countdown state
  currentAutoDismissMs = initialAutoDismissMs;
  remainingTimeMs = initialAutoDismissMs;
  countdownStartTime = Date.now();
  isAutoDismissPaused = false;

  // Reset and restart countdown bar animation
  if (countdownBar) {
    countdownBar.style.transition = 'none';
    countdownBar.style.width = '100%';
    // Force reflow to restart animation
    void countdownBar.offsetWidth;
    startCountdownAnimation(initialAutoDismissMs);
  }

  // Set new timer
  autoDismissTimer = window.setTimeout(() => {
    removeSavePrompt();
    onAutoDismissCallback?.();
  }, initialAutoDismissMs);
}

/**
 * Set up listeners to pause/resume countdown on hover and focus.
 */
function setupPauseListeners(prompt: HTMLElement): void {
  prompt.addEventListener('mouseenter', pauseCountdown);
  prompt.addEventListener('mouseleave', resumeCountdown);
  prompt.addEventListener('focusin', pauseCountdown);
  prompt.addEventListener('focusout', (e: FocusEvent) => {
    // Only resume if focus moved outside the prompt
    if (!prompt.contains(e.relatedTarget as Node)) {
      resumeCountdown();
    }
  });
}

/**
 * Remove the current save prompt.
 */
export function removeSavePrompt(): void {
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer);
    autoDismissTimer = null;
  }

  // Reset countdown state
  isAutoDismissPaused = false;
  remainingTimeMs = 0;
  countdownStartTime = 0;
  currentAutoDismissMs = 0;
  initialAutoDismissMs = 0;
  onAutoDismissCallback = null;

  // Reset login state
  currentLogin = null;
  currentOnSave = null;

  // Stop countdown bar animation
  if (countdownBar) {
    countdownBar.style.transition = 'none';
    countdownBar = null;
  }

  if (currentPrompt) {
    currentPrompt.classList.remove('av-save-prompt--visible');
    // Wait for animation to complete before removing
    setTimeout(() => {
      currentPrompt?.remove();
      currentPrompt = null;
    }, 200);
  }
}

/**
 * Check if a save prompt is currently visible.
 */
export function isSavePromptVisible(): boolean {
  return currentPrompt !== null;
}

/**
 * Update the currently visible save prompt with new login credentials.
 * This allows subsequent login attempts to update the credentials that will be saved.
 * @param login - The new captured login credentials.
 */
export function updateSavePromptLogin(login: CapturedLogin): void {
  if (!currentPrompt) {
    return;
  }

  // Update the stored login
  currentLogin = login;

  // Update the UI to reflect the new credentials
  const usernameSpan = currentPrompt.querySelector('.av-save-prompt__username');
  const passwordSpan = currentPrompt.querySelector('.av-save-prompt__password');
  const serviceInput = currentPrompt.querySelector('.av-save-prompt__service-input') as HTMLInputElement;

  if (usernameSpan) {
    usernameSpan.textContent = login.username;
  }

  if (passwordSpan) {
    // Create masked password display
    const maskedPassword = '•'.repeat(Math.min(login.password.length, 12));
    passwordSpan.textContent = maskedPassword;
  }

  // Update service name input if it still has the default value
  if (serviceInput && serviceInput.dataset.domain === login.domain) {
    // Only update if user hasn't modified the input
    const currentValue = serviceInput.value;
    const previousSuggestedName = serviceInput.defaultValue;
    if (currentValue === previousSuggestedName) {
      serviceInput.value = login.suggestedName;
      serviceInput.defaultValue = login.suggestedName;
    }
  }

  // Reset the auto-dismiss timer to give user time to review new credentials
  resetCountdown();

  console.debug('[AliasVault] Updated save prompt with new credentials');
}

/**
 * Create the HTML for the save prompt.
 */
async function createPromptHTML(login: CapturedLogin): Promise<string> {
  const escapedUsername = escapeHtml(login.username);
  const escapedSuggestedName = escapeHtml(login.suggestedName);
  const escapedDomain = escapeHtml(login.domain);
  // Create masked password display (show length but not actual characters)
  const maskedPassword = '•'.repeat(Math.min(login.password.length, 12));

  // Get translated strings
  const titleText = await t('content.savePrompt.title');
  const saveText = await t('content.savePrompt.save');
  const neverText = await t('content.savePrompt.neverForThisSite');
  const dismissText = await t('content.savePrompt.dismiss');

  return `
    <div class="av-save-prompt__content">
      <div class="av-save-prompt__icon">
        ${getLogoMarkSvg(24, 24)}
      </div>
      <div class="av-save-prompt__title">${titleText}</div>
      <div class="av-save-prompt__fields">
        <input type="text" class="av-save-prompt__service-input" value="${escapedSuggestedName}" data-domain="${escapedDomain}" placeholder="Service name" />
        <span class="av-save-prompt__username">${escapedUsername}</span>
        <span class="av-save-prompt__password">${maskedPassword}</span>
      </div>
      <div class="av-save-prompt__actions">
        <button class="av-save-prompt__btn av-save-prompt__btn--save">
          ${saveText}
        </button>
        <button class="av-save-prompt__btn av-save-prompt__btn--never">
          ${neverText}
        </button>
        <button class="av-save-prompt__btn av-save-prompt__btn--dismiss" aria-label="${dismissText}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="av-save-prompt__countdown">
      <div class="av-save-prompt__countdown-bar"></div>
    </div>
  `;
}

/**
 * Set up event listeners for the prompt buttons.
 */
function setupEventListeners(
  prompt: HTMLElement,
  login: CapturedLogin,
  onSave: (login: CapturedLogin, serviceName: string) => void,
  onNeverSave: (domain: string) => void,
  onDismiss: () => void
): void {
  const saveBtn = prompt.querySelector('.av-save-prompt__btn--save');
  const neverBtn = prompt.querySelector('.av-save-prompt__btn--never');
  const dismissBtn = prompt.querySelector('.av-save-prompt__btn--dismiss');
  const serviceInput = prompt.querySelector('.av-save-prompt__service-input') as HTMLInputElement;

  saveBtn?.addEventListener('click', () => {
    // Use currentLogin to get the latest credentials (may have been updated)
    const loginToSave = currentLogin || login;
    const saveCallback = currentOnSave || onSave;
    const serviceName = serviceInput?.value || loginToSave.suggestedName;
    removeSavePrompt();
    saveCallback(loginToSave, serviceName);
  });

  neverBtn?.addEventListener('click', () => {
    // Use currentLogin to get the latest domain
    const loginToUse = currentLogin || login;
    removeSavePrompt();
    onNeverSave(loginToUse.domain);
  });

  dismissBtn?.addEventListener('click', () => {
    removeSavePrompt();
    onDismiss();
  });

  // Handle Enter key in service name input
  serviceInput?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Use currentLogin to get the latest credentials
      const loginToSave = currentLogin || login;
      const saveCallback = currentOnSave || onSave;
      const serviceName = serviceInput.value || loginToSave.suggestedName;
      removeSavePrompt();
      saveCallback(loginToSave, serviceName);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      removeSavePrompt();
      onDismiss();
    }
  });

  // Handle Escape key anywhere in the prompt
  prompt.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      removeSavePrompt();
      onDismiss();
    }
  });
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
