/**
 * Clipboard copy with auto-clear behaviour.
 */

/** Clipboard clear status. */
export type ClipboardStatus = 'active' | 'pending' | 'manual_clear_required' | 'cleared';

type CopyListener = (copiedId: string) => void;
type ProgressListener = (progress: number) => void;
type StatusListener = (status: ClipboardStatus) => void;

/** How long the "copied" highlight stays on the copied element. */
const COPIED_STATE_MS = 2000;

/** Tolerance on the clear timer to account for slightly early ticks. */
const CLEAR_TOLERANCE_MS = 100;

/**
 * Clipboard copy and clear coordinator.
 */
class ClipboardCopyService {
  private currentCopiedId = '';
  private copiedStateTimer: ReturnType<typeof setTimeout> | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private clearByTime: number | null = null;
  private clearDurationMs = 0;
  private failedAttempts = 0;
  private copyListeners: CopyListener[] = [];
  private progressListeners: ProgressListener[] = [];
  private statusListeners: StatusListener[] = [];
  private listenersAttached = false;

  /**
   * Copy a value and schedule the clear. Returns whether the copy succeeded.
   * @param id - the id of the element the value came from
   * @param value - the value to copy
   * @param clearAfterSeconds - seconds until the clipboard is cleared, 0 to never clear
   */
  public async copy(id: string, value: string, clearAfterSeconds: number): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      console.error('[Clipboard] Failed to copy to clipboard:', error);
      return false;
    }

    this.attachWindowListeners();
    this.setCopied(id);
    if (clearAfterSeconds > 0) {
      this.scheduleClear(clearAfterSeconds);
    }
    return true;
  }

  /**
   * The id of the element whose value was copied last, empty once the highlight expired.
   */
  public getCopiedId(): string {
    return this.currentCopiedId;
  }

  /**
   * Subscribe to copies. Returns the unsubscribe function.
   */
  public subscribe(listener: CopyListener): () => void {
    this.copyListeners.push(listener);
    return (): void => {
      this.copyListeners = this.copyListeners.filter(l => l !== listener);
    };
  }

  /**
   * Subscribe to countdown progress (1 at the start of the countdown, 0 when done). Returns the unsubscribe function.
   */
  public subscribeProgress(listener: ProgressListener): () => void {
    this.progressListeners.push(listener);
    return (): void => {
      this.progressListeners = this.progressListeners.filter(l => l !== listener);
    };
  }

  /**
   * Subscribe to clear status changes. Returns the unsubscribe function.
   */
  public subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.push(listener);
    return (): void => {
      this.statusListeners = this.statusListeners.filter(l => l !== listener);
    };
  }

  /**
   * Clear the clipboard now, on the user's request.
   */
  public async clearNow(): Promise<boolean> {
    return this.attemptClear(true);
  }

  /**
   * Mark an element as copied and start the highlight timer.
   */
  private setCopied(id: string): void {
    this.currentCopiedId = id;
    this.copyListeners.forEach(l => l(id));

    if (this.copiedStateTimer) {
      clearTimeout(this.copiedStateTimer);
    }
    this.copiedStateTimer = setTimeout(() => {
      this.currentCopiedId = '';
      this.copiedStateTimer = null;
      this.copyListeners.forEach(l => l(''));
    }, COPIED_STATE_MS);
  }

  /**
   * Start the countdown to the clear.
   */
  private scheduleClear(seconds: number): void {
    this.stopTimers();
    this.failedAttempts = 0;
    this.clearDurationMs = seconds * 1000;
    this.clearByTime = Date.now() + this.clearDurationMs;
    this.notifyStatus('active');

    this.progressTimer = setInterval(() => this.updateProgress(), 100);
    this.updateProgress();
    this.clearTimer = setTimeout(() => void this.attemptClear(false), this.clearDurationMs);
  }

  /**
   * Push the remaining fraction of the countdown to the bar.
   */
  private updateProgress(): void {
    if (this.clearByTime === null || this.clearDurationMs <= 0) {
      return;
    }
    const progress = Math.max(0, this.clearByTime - Date.now()) / this.clearDurationMs;
    this.progressListeners.forEach(l => l(progress));
    if (progress <= 0 && this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  /**
   * Try to clear the clipboard. The browser refuses while the document is not focused, in which case the clear
   * is retried on focus and, after two failures, marked as manual clear required.
   */
  private async attemptClear(manual: boolean): Promise<boolean> {
    if (this.clearByTime === null) {
      return false;
    }
    if (!manual && this.clearByTime - Date.now() > CLEAR_TOLERANCE_MS) {
      return false;
    }

    try {
      await navigator.clipboard.writeText('');
      this.clearByTime = null;
      this.failedAttempts = 0;
      this.stopTimers();
      this.progressListeners.forEach(l => l(0));
      this.notifyStatus('cleared');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notFocused = (error instanceof Error && error.name === 'NotAllowedError') || message.includes('Document is not focused');
      if (!notFocused) {
        console.warn('[Clipboard] Failed to clear clipboard:', error);
        return false;
      }
      this.failedAttempts++;
      this.notifyStatus(this.failedAttempts >= 2 ? 'manual_clear_required' : 'pending');
      return false;
    }
  }

  /**
   * Retry a due clear once the page regains focus or visibility.
   */
  private checkAndClear(): void {
    if (this.clearByTime !== null && Date.now() >= this.clearByTime) {
      setTimeout(() => void this.attemptClear(false), 100);
    }
  }

  /**
   * Listen for the page becoming visible again, once.
   */
  private attachWindowListeners(): void {
    if (this.listenersAttached) {
      return;
    }
    this.listenersAttached = true;
    window.addEventListener('focus', () => this.checkAndClear());
    window.addEventListener('pageshow', () => this.checkAndClear());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.checkAndClear();
      }
    });
  }

  /**
   * Stop the countdown timers.
   */
  private stopTimers(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
  }

  /**
   * Tell the bar about a status change.
   */
  private notifyStatus(status: ClipboardStatus): void {
    this.statusListeners.forEach(l => l(status));
  }
}

/** The page's clipboard service. */
export const clipboardCopyService = new ClipboardCopyService();
