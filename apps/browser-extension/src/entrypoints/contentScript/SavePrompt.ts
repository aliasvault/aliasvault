/**
 * Save prompt UI component for offering to save detected login credentials.
 * Displays a non-intrusive banner at the top of the page when credentials are detected.
 */

import { sendMessage } from 'webext-bridge/content-script';

import { getLogoMarkSvg } from '@/utils/constants/logo';
import type { CapturedLogin, SavePromptOptions, SavePromptPersistedState } from '@/utils/loginDetector';

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

  /*
   * Persist state immediately so it survives navigation.
   */
  await persistSavePromptState();
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
 * @param clearPersisted - Whether to also clear the persisted state (default: true).
 *                         Set to false when restoring from persisted state.
 */
export function removeSavePrompt(clearPersisted: boolean = true): void {
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

  // Clear persisted state if user took an action
  if (clearPersisted) {
    void clearPersistedSavePromptState();
  }

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
 * Restore a save prompt from persisted state.
 * Used to continue showing the prompt after a page navigation.
 * @param container - The shadow DOM container to append the prompt to.
 * @param state - The persisted state to restore from.
 * @param onSave - Callback when user clicks "Save".
 * @param onNeverSave - Callback when user clicks "Never for this site".
 * @param onDismiss - Callback when prompt is dismissed.
 */
export async function restoreSavePromptFromState(
  container: HTMLElement,
  state: SavePromptPersistedState,
  onSave: (login: CapturedLogin, serviceName: string) => void,
  onNeverSave: (domain: string) => void,
  onDismiss: () => void
): Promise<void> {
  // Clear the persisted state now that we're restoring
  await clearPersistedSavePromptState();

  // Remove any existing prompt first (without clearing persisted state again)
  removeSavePrompt(false);

  const { login, remainingTimeMs: restoredRemainingTime, initialAutoDismissMs: restoredInitialMs } = state;

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

  // Set up auto-dismiss with the remaining time from persisted state
  if (restoredRemainingTime > 0) {
    // Initialize countdown state with remaining time
    initialAutoDismissMs = restoredInitialMs;
    currentAutoDismissMs = restoredRemainingTime;
    remainingTimeMs = restoredRemainingTime;
    countdownStartTime = Date.now();
    isAutoDismissPaused = false;
    onAutoDismissCallback = onDismiss;

    // Create countdown bar and start with adjusted width
    countdownBar = prompt.querySelector('.av-save-prompt__countdown-bar') as HTMLElement;

    // Calculate what percentage of time is remaining
    const percentRemaining = (restoredRemainingTime / restoredInitialMs) * 100;

    if (countdownBar) {
      // Set initial width to reflect remaining time (no transition yet)
      countdownBar.style.transition = 'none';
      countdownBar.style.width = `${percentRemaining}%`;

      /*
       * Use double requestAnimationFrame to ensure the initial width is rendered
       * before starting the transition. Single rAF can batch with the width set.
       */
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (countdownBar) {
            countdownBar.style.transition = `width ${restoredRemainingTime}ms linear`;
            countdownBar.style.width = '0%';
          }
        });
      });
    }

    autoDismissTimer = window.setTimeout(() => {
      removeSavePrompt();
      onDismiss();
    }, restoredRemainingTime);

    // Set up hover/focus listeners to pause countdown
    setupPauseListeners(prompt);
  }

  // Set up event listeners
  setupEventListeners(prompt, login, onSave, onNeverSave, onDismiss);
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
}

/**
 * Create the HTML for the save prompt.
 */
async function createPromptHTML(login: CapturedLogin): Promise<string> {
  const escapedUsername = escapeHtml(login.username);
  const escapedSuggestedName = escapeHtml(login.suggestedName);
  const escapedDomain = escapeHtml(login.domain);
  const maskedPassword = '•'.repeat(12); // Static 12 characters for password display

  const titleText = await t('content.savePrompt.title');
  const saveText = await t('common.save');
  const neverText = await t('content.savePrompt.neverForThisSite');
  const dismissText = await t('common.dismiss');

  return `
    <div class="av-save-prompt__countdown">
      <div class="av-save-prompt__countdown-bar"></div>
    </div>
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

/**
 * Calculate the current remaining time for the countdown.
 * @returns The remaining time in milliseconds, or 0 if expired.
 */
function calculateRemainingTime(): number {
  if (!countdownStartTime || currentAutoDismissMs <= 0) {
    return 0;
  }

  if (isAutoDismissPaused) {
    return remainingTimeMs;
  }

  const elapsed = Date.now() - countdownStartTime;
  return Math.max(0, currentAutoDismissMs - elapsed);
}

/**
 * Persist the current save prompt state to the background script.
 * The background script stores this in memory, which survives content script navigation.
 */
async function persistSavePromptState(): Promise<void> {
  if (!currentLogin) {
    return;
  }

  // Calculate current remaining time
  const timeRemaining = calculateRemainingTime();

  // Don't persist if time has expired
  if (timeRemaining <= 0) {
    return;
  }

  const state: SavePromptPersistedState = {
    login: currentLogin,
    remainingTimeMs: timeRemaining,
    initialAutoDismissMs,
    savedAt: Date.now(),
    domain: currentLogin.domain,
  };

  try {
    await sendMessage('STORE_SAVE_PROMPT_STATE', state, 'background');
  } catch (error) {
    console.error('[AliasVault] Error persisting save prompt state:', error);
  }
}

/**
 * Get persisted save prompt state from the background script.
 * @returns The persisted state if valid, null otherwise.
 */
export async function getPersistedSavePromptState(): Promise<SavePromptPersistedState | null> {
  try {
    const response = await sendMessage('GET_SAVE_PROMPT_STATE', {}, 'background') as {
      success: boolean;
      state: SavePromptPersistedState | null;
    };

    if (!response.success || !response.state) {
      return null;
    }

    const state = response.state;

    // Validate the state is still relevant
    const currentDomain = window.location.hostname;

    // Check if we're on the same domain (or a related domain after redirect)
    if (state.domain !== currentDomain) {
      // Allow if we're on a subdomain or parent domain
      const isRelatedDomain = currentDomain.endsWith(`.${state.domain}`) ||
                              state.domain.endsWith(`.${currentDomain}`) ||
                              // Also allow if they share the same base domain (e.g., login.example.com -> app.example.com)
                              getBaseDomain(currentDomain) === getBaseDomain(state.domain);

      if (!isRelatedDomain) {
        await clearPersistedSavePromptState();
        return null;
      }
    }

    // The background script already adjusts the remaining time, but check if expired
    if (state.remainingTimeMs <= 0) {
      await clearPersistedSavePromptState();
      return null;
    }

    return state;
  } catch (error) {
    console.error('[AliasVault] Error reading persisted save prompt state:', error);
    return null;
  }
}

/**
 * Clear persisted save prompt state from the background script.
 */
export async function clearPersistedSavePromptState(): Promise<void> {
  try {
    await sendMessage('CLEAR_SAVE_PROMPT_STATE', {}, 'background');
  } catch (error) {
    console.error('[AliasVault] Error clearing persisted save prompt state:', error);
  }
}

/**
 * Extract the base domain from a hostname (e.g., "login.example.com" -> "example.com").
 */
function getBaseDomain(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 2) {
    return hostname;
  }
  // Return the last two parts (this is a simple heuristic, doesn't handle all TLDs)
  return parts.slice(-2).join('.');
}

