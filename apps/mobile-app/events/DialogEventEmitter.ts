/**
 * Simple event emitter for showing dialogs from outside React components.
 * This allows AuthContext to trigger dialogs in DialogContext without direct coupling.
 */

type AlertListener = (title: string, message: string) => void;

class DialogEventEmitter {
  private listeners: AlertListener[] = [];

  /**
   * Subscribe to alert events.
   * @returns Unsubscribe function
   */
  subscribe(listener: AlertListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Emit an alert event to all listeners.
   */
  emitAlert(title: string, message: string): void {
    this.listeners.forEach(listener => listener(title, message));
  }
}

export const dialogEventEmitter = new DialogEventEmitter();
