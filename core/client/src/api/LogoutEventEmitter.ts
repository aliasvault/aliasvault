type LogoutListener = (errorMessage: string) => void | Promise<void>;

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
   * @param errorKey - The translation key of the error message to emit.
   */
  public emit(errorTranslationKey: string): void {
    this.listeners.forEach(listener => {
      try {
        listener(errorTranslationKey);
      } catch (error) {
        console.error('Error in logout listener:', error);
      }
    });
  }
}

// Export singleton instance
export const logoutEventEmitter = new LogoutEventEmitter();
