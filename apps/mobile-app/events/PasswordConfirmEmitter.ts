/**
 * Event emitter for password confirmation results.
 */

type PasswordConfirmEvent = 'confirmed' | 'cancelled';
type ConfirmedListener = (passwordHash: string) => void;
type CancelledListener = () => void;

class PasswordConfirmEmitter {
  private confirmedListeners: ConfirmedListener[] = [];
  private cancelledListeners: CancelledListener[] = [];

  /**
   * Subscribe to the 'confirmed' event.
   * Called when password is successfully verified.
   * @param listener - Receives the password hash (base64)
   * @returns Unsubscribe function
   */
  onConfirmed(listener: ConfirmedListener): () => void {
    this.confirmedListeners.push(listener);
    return () => {
      this.confirmedListeners = this.confirmedListeners.filter(l => l !== listener);
    };
  }

  /**
   * Subscribe to the 'cancelled' event.
   * Called when user cancels password confirmation.
   * @returns Unsubscribe function
   */
  onCancelled(listener: CancelledListener): () => void {
    this.cancelledListeners.push(listener);
    return () => {
      this.cancelledListeners = this.cancelledListeners.filter(l => l !== listener);
    };
  }

  /**
   * Emit an event.
   * @param event - The event type
   * @param payload - Optional payload (password hash for 'confirmed')
   */
  emit(event: PasswordConfirmEvent, payload?: string): void {
    if (event === 'confirmed' && payload) {
      this.confirmedListeners.forEach(listener => listener(payload));
    } else if (event === 'cancelled') {
      this.cancelledListeners.forEach(listener => listener());
    }
  }

  /**
   * Remove all listeners. Useful for cleanup.
   */
  removeAllListeners(): void {
    this.confirmedListeners = [];
    this.cancelledListeners = [];
  }
}

export const passwordConfirmEmitter = new PasswordConfirmEmitter();
