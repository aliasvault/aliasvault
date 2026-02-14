import { extractFaviconUrlSimple } from '@/utils/favicon';
import { FormDetector } from '@/utils/formDetector/FormDetector';

import type { CapturedLogin, LoginSubmissionEvent, LoginCaptureCallback } from './types';

/**
 * Detects login form submissions and extracts credentials.
 * Supports both traditional form submissions and AJAX-based logins
 * (where submit buttons trigger JavaScript handlers instead of native form submit).
 *
 * When a login is detected and the credentials are not yet in the vault,
 * this enables offering to save them.
 */
export class LoginDetector {
  private readonly document: Document;
  private readonly callbacks: Set<LoginCaptureCallback> = new Set();
  private isInitialized = false;
  private pendingSubmission: LoginSubmissionEvent | null = null;

  /** Track forms we're monitoring to avoid duplicate listeners */
  private monitoredForms: WeakSet<HTMLFormElement> = new WeakSet();

  /** Track buttons we're monitoring to avoid duplicate listeners */
  private monitoredButtons: WeakSet<HTMLElement> = new WeakSet();

  /** MutationObserver for dynamically added forms */
  private mutationObserver: MutationObserver | null = null;

  /** Debounce timer to prevent duplicate captures */
  private captureDebounceTimer: number | null = null;
  private lastCapturedLogin: CapturedLogin | null = null;

  /** Domains to exclude from login detection (only AliasVault itself) */
  private static readonly EXCLUDED_DOMAINS = [
    'aliasvault.net',
  ];

  /**
   * Creates a new LoginDetector instance.
   * @param document - The document to monitor for login form submissions.
   */
  public constructor(document: Document) {
    this.document = document;
  }

  /**
   * Initialize the login detector.
   * Sets up event listeners for form submissions.
   */
  public initialize(): void {
    if (this.isInitialized) {
      return;
    }

    // Check if we should skip this page
    if (this.shouldSkipPage()) {
      return;
    }

    // Monitor existing forms
    this.monitorExistingForms();

    // Watch for dynamically added forms
    this.setupMutationObserver();

    // Listen for beforeunload to handle navigation-based submissions
    window.addEventListener('beforeunload', this.handleBeforeUnload);

    this.isInitialized = true;
  }

  /**
   * Clean up event listeners and observers.
   */
  public destroy(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    window.removeEventListener('beforeunload', this.handleBeforeUnload);

    if (this.captureDebounceTimer) {
      clearTimeout(this.captureDebounceTimer);
      this.captureDebounceTimer = null;
    }

    this.callbacks.clear();
    this.pendingSubmission = null;
    this.lastCapturedLogin = null;
    this.isInitialized = false;
  }

  /**
   * Register a callback to be called when a login is captured.
   * Returns an unsubscribe function.
   * @param callback - The callback function to register.
   * @returns A function to unsubscribe the callback.
   */
  public onLoginCapture(callback: LoginCaptureCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Check if the current page should be skipped for login detection.
   */
  private shouldSkipPage(): boolean {
    const hostname = window.location.hostname.toLowerCase();

    // Check excluded domains
    for (const domain of LoginDetector.EXCLUDED_DOMAINS) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return true;
      }
    }

    // Check if av-disable attribute is set on body or html element
    const avDisable = (this.document.body?.getAttribute('av-disable') ?? this.document.documentElement.getAttribute('av-disable')) === 'true';
    if (avDisable) {
      return true;
    }

    return false;
  }

  /**
   * Find and monitor all existing forms on the page.
   */
  private monitorExistingForms(): void {
    const forms = this.document.querySelectorAll('form');
    forms.forEach(form => this.monitorForm(form));
  }

  /**
   * Set up MutationObserver to detect dynamically added forms and buttons.
   */
  private setupMutationObserver(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLFormElement) {
            this.monitorForm(node);
          } else if (node instanceof HTMLElement) {
            // Check for forms inside added elements
            const forms = node.querySelectorAll('form');
            forms.forEach(form => this.monitorForm(form));

            // Check for buttons added to existing forms
            this.checkForNewButtonsInForms(node);
          }
        }
      }
    });

    this.mutationObserver.observe(this.document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Check if a newly added element contains buttons that belong to monitored forms.
   */
  private checkForNewButtonsInForms(element: HTMLElement): void {
    // Check if the element itself is a button
    if (this.isSubmitButton(element)) {
      const form = element.closest('form');
      if (form && this.monitoredForms.has(form)) {
        this.monitorButton(element, form);
      }
    }

    // Check for buttons inside the element
    const buttons = element.querySelectorAll<HTMLElement>(
      'button[type="submit"], input[type="submit"], button:not([type]), [role="button"]'
    );

    for (const button of buttons) {
      const form = button.closest('form');
      if (form && this.monitoredForms.has(form)) {
        this.monitorButton(button, form);
      }
    }
  }

  /**
   * Check if an element is a submit button.
   */
  private isSubmitButton(element: HTMLElement): boolean {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'button') {
      const type = element.getAttribute('type');
      return type === 'submit' || type === null;
    }

    if (tagName === 'input') {
      return element.getAttribute('type') === 'submit';
    }

    return element.getAttribute('role') === 'button';
  }

  /**
   * Add submit event listener to a form and monitor its submit buttons.
   */
  private monitorForm(form: HTMLFormElement): void {
    if (this.monitoredForms.has(form)) {
      return;
    }

    this.monitoredForms.add(form);

    // Use capture phase to get the event before it might be prevented
    form.addEventListener('submit', (event) => {
      this.handleFormSubmit(form, event);
    }, { capture: true });

    // Also monitor submit buttons for AJAX-based logins
    this.monitorSubmitButtons(form);
  }

  /**
   * Find and monitor submit buttons within a form.
   * This handles cases where sites use JavaScript to submit forms via AJAX
   * instead of native form submission.
   */
  private monitorSubmitButtons(form: HTMLFormElement): void {
    // Find all potential submit buttons
    const buttons = form.querySelectorAll<HTMLElement>(
      'button[type="submit"], input[type="submit"], button:not([type]), [role="button"]'
    );

    for (const button of buttons) {
      this.monitorButton(button, form);
    }
  }

  /**
   * Add click listener to a submit button.
   */
  private monitorButton(button: HTMLElement, form: HTMLFormElement): void {
    if (this.monitoredButtons.has(button)) {
      return;
    }

    this.monitoredButtons.add(button);

    // Use capture phase to catch the click before any preventDefault
    button.addEventListener('click', () => {
      this.handleButtonClick(form);
    }, { capture: true });
  }

  /**
   * Handle submit button click.
   * This captures credentials when the button is clicked, which works for
   * both native form submissions and AJAX-based logins.
   */
  private handleButtonClick(form: HTMLFormElement): void {
    const credentials = this.extractCredentialsFromForm(form);

    if (credentials) {
      this.pendingSubmission = {
        form,
        fields: {
          username: credentials.usernameField,
          password: credentials.passwordField,
        },
        method: 'ajax',
      };

      // Build and emit the captured login
      const capturedLogin = this.buildCapturedLogin(
        credentials.username,
        credentials.password
      );

      this.emitLoginDebounced(capturedLogin);
    }
  }

  /**
   * Handle form submit event.
   */
  private handleFormSubmit(form: HTMLFormElement, _event: Event): void {
    const credentials = this.extractCredentialsFromForm(form);

    if (credentials) {
      this.pendingSubmission = {
        form,
        fields: {
          username: credentials.usernameField,
          password: credentials.passwordField,
        },
        method: 'form-submit',
      };

      // Build and emit the captured login
      const capturedLogin = this.buildCapturedLogin(
        credentials.username,
        credentials.password
      );

      this.emitLoginDebounced(capturedLogin);
    }
  }

  /**
   * Handle beforeunload event.
   */
  private handleBeforeUnload = (): void => {
    // Clear pending submission as page is unloading
    this.pendingSubmission = null;
  };

  /**
   * Extract credentials from a form using FormDetector.
   */
  private extractCredentialsFromForm(form: HTMLFormElement): {
    username: string;
    password: string;
    usernameField: HTMLInputElement | null;
    passwordField: HTMLInputElement | null;
  } | null {
    // Find password field directly in the form first
    const passwordInputs = form.querySelectorAll<HTMLInputElement>('input[type="password"]');
    if (passwordInputs.length === 0) {
      return null;
    }

    // Get the first visible password field with a value
    let passwordField: HTMLInputElement | null = null;
    for (const input of passwordInputs) {
      if (input.value && this.isElementVisible(input)) {
        passwordField = input;
        break;
      }
    }

    if (!passwordField) {
      return null;
    }

    const password = passwordField.value;

    // Use FormDetector to find the username/email field
    const formDetector = new FormDetector(this.document, form);
    const formFields = formDetector.getForm();

    // Get username from various possible fields
    let usernameField: HTMLInputElement | null = null;
    let username = '';

    if (formFields) {
      // Priority: username field > email field
      if (formFields.usernameField?.value) {
        usernameField = formFields.usernameField;
        username = formFields.usernameField.value;
      } else if (formFields.emailField?.value) {
        usernameField = formFields.emailField;
        username = formFields.emailField.value;
      }
    }

    // Fallback: look for text/email inputs before the password field
    if (!username) {
      const allInputs = form.querySelectorAll<HTMLInputElement>('input');
      for (const input of allInputs) {
        if (input === passwordField) {
          break; // Stop when we reach the password field
        }
        const type = input.type.toLowerCase();
        if ((type === 'text' || type === 'email') && input.value && this.isElementVisible(input)) {
          usernameField = input;
          username = input.value;
          break;
        }
      }
    }

    // We need both username and password
    if (!username || !password) {
      return null;
    }

    return {
      username,
      password,
      usernameField,
      passwordField,
    };
  }

  /**
   * Check if an element is visible.
   */
  private isElementVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      parseFloat(style.opacity) > 0
    );
  }

  /**
   * Build a CapturedLogin object from extracted values.
   */
  private buildCapturedLogin(username: string, password: string): CapturedLogin {
    const url = window.location.href;
    const domain = window.location.hostname;

    // Get suggested name using FormDetector's static method
    const suggestedNames = FormDetector.getSuggestedServiceName(this.document, window.location);
    const suggestedName = suggestedNames[0] || domain;

    // Extract favicon URL
    const faviconUrl = this.extractFaviconUrl();

    return {
      username,
      password,
      url,
      domain,
      timestamp: Date.now(),
      suggestedName,
      faviconUrl,
    };
  }

  /**
   * Extract the page favicon URL.
   * Uses the shared FaviconExtractor utility for consistent extraction across the extension.
   */
  private extractFaviconUrl(): string | undefined {
    return extractFaviconUrlSimple(this.document);
  }

  /**
   * Emit login with debouncing to prevent duplicates.
   */
  private emitLoginDebounced(login: CapturedLogin): void {
    /*
     * Check if this is the exact same login we just captured (including password).
     * We include password in the comparison so that retries with different passwords
     * are still emitted and can update the save prompt with new credentials.
     */
    if (this.lastCapturedLogin &&
        this.lastCapturedLogin.username === login.username &&
        this.lastCapturedLogin.password === login.password &&
        this.lastCapturedLogin.domain === login.domain &&
        Date.now() - this.lastCapturedLogin.timestamp < 5000) {
      // Skip duplicate within 5 seconds
      return;
    }

    // Clear any pending debounce
    if (this.captureDebounceTimer) {
      clearTimeout(this.captureDebounceTimer);
    }

    // Store as last captured
    this.lastCapturedLogin = login;

    // Small delay to allow for form validation errors to appear
    this.captureDebounceTimer = window.setTimeout(() => {
      this.emitLogin(login);
      this.captureDebounceTimer = null;
    }, 100);
  }

  /**
   * Emit captured login to all registered callbacks.
   */
  private emitLogin(login: CapturedLogin): void {
    for (const callback of this.callbacks) {
      try {
        callback(login);
      } catch (error) {
        console.error('[AliasVault] Error in login capture callback:', error);
      }
    }
  }
}
