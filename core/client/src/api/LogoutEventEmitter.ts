import { logDefect } from '../utilities/Diagnostics';

import type { TranslationKey } from '@aliasvault/i18n';

type LogoutListener = (messageKey: TranslationKey) => void | Promise<void>;

/**
 * Simple event emitter for logout events to avoid circular dependencies
 * between WebApiService and Auth contexts.
 */
class LogoutEventEmitter {
  private listeners: Set<LogoutListener> = new Set();

  /**
   * Subscribe to logout events.
   * Returns an unsubscribe function.
   */
  public subscribe(listener: LogoutListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Emit a logout event to all listeners.
   *
   * @param messageKey - The translation key of the message to show on the login page.
   */
  public emit(messageKey: TranslationKey): void {
    this.listeners.forEach(listener => {
      try {
        listener(messageKey);
      } catch (error) {
        logDefect('[Logout] A logout listener threw', error);
      }
    });
  }
}

// Export singleton instance
export const logoutEventEmitter = new LogoutEventEmitter();
