import { JSDOM } from 'jsdom';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

import type { CapturedLogin, SavePromptPersistedState } from '@/utils/loginDetector';

/**
 * Mock storage for save prompt state in background script.
 */
let mockBackgroundState: SavePromptPersistedState | null = null;

vi.mock('webext-bridge/content-script', () => ({
  /**
   * Mock sendMessage function.
   */
  sendMessage: vi.fn().mockImplementation((messageType: string, data: unknown) => {
    if (messageType === 'STORE_SAVE_PROMPT_STATE') {
      mockBackgroundState = data as SavePromptPersistedState;
      return Promise.resolve({ success: true });
    }
    if (messageType === 'GET_SAVE_PROMPT_STATE') {
      if (!mockBackgroundState) {
        return Promise.resolve({ success: true, state: null });
      }
      // Calculate adjusted remaining time
      const elapsedSinceSave = Date.now() - mockBackgroundState.savedAt;
      const adjustedRemainingTime = mockBackgroundState.remainingTimeMs - elapsedSinceSave;
      if (adjustedRemainingTime <= 0) {
        mockBackgroundState = null;
        return Promise.resolve({ success: true, state: null });
      }
      return Promise.resolve({
        success: true,
        state: {
          ...mockBackgroundState,
          remainingTimeMs: adjustedRemainingTime,
        },
      });
    }
    if (messageType === 'CLEAR_SAVE_PROMPT_STATE') {
      mockBackgroundState = null;
      return Promise.resolve({ success: true });
    }
    return Promise.resolve({ success: false });
  }),
}));

vi.mock('@/i18n/StandaloneI18n', () => ({
  /**
   * Mock t function.
   */
  t: vi.fn().mockImplementation((key: string) => Promise.resolve(key)),
}));

vi.mock('@/utils/constants/logo', () => ({
  /**
   * Mock getLogoMarkSvg function.
   */
  getLogoMarkSvg: vi.fn().mockReturnValue('<svg></svg>'),
}));

// Import after mocks
import {
  showSavePrompt,
  removeSavePrompt,
  isSavePromptVisible,
  getPersistedSavePromptState,
  restoreSavePromptFromState,
} from '../SavePrompt';

describe('SavePrompt persistence', () => {
  let dom: JSDOM;
  let container: HTMLElement;
  let mockLogin: CapturedLogin;
  let onSave: Mock;
  let onNeverSave: Mock;
  let onDismiss: Mock;

  // Store original globals
  const originalWindow = global.window;
  const originalDocument = global.document;
  const originalRequestAnimationFrame = global.requestAnimationFrame;

  beforeEach(() => {
    // Clear mock background state
    mockBackgroundState = null;

    // Set up JSDOM
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://example.com/login',
      runScripts: 'dangerously',
    });

    // Mock requestAnimationFrame
    const rafMock = vi.fn().mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    dom.window.requestAnimationFrame = rafMock;

    // Set up global window and document
    (global as unknown as { window: typeof dom.window }).window = dom.window;
    (global as unknown as { document: typeof dom.window.document }).document = dom.window.document;
    (global as unknown as { requestAnimationFrame: typeof rafMock }).requestAnimationFrame = rafMock;

    // Create container for the prompt
    container = dom.window.document.createElement('div');
    container.id = 'test-container';
    dom.window.document.body.appendChild(container);

    // Set up mock login data
    mockLogin = {
      username: 'testuser@example.com',
      password: 'testpassword123',
      url: 'https://example.com/login',
      domain: 'example.com',
      timestamp: Date.now(),
      suggestedName: 'Example Site',
      faviconUrl: 'https://example.com/favicon.ico',
    };

    // Set up callback mocks
    onSave = vi.fn();
    onNeverSave = vi.fn();
    onDismiss = vi.fn();

    // Use fake timers
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Clean up any visible prompts
    if (isSavePromptVisible()) {
      removeSavePrompt(false);
      // Run timers to complete the removal animation
      vi.advanceTimersByTime(300);
    }

    vi.useRealTimers();
    vi.restoreAllMocks();

    // Restore original globals
    if (originalWindow) {
      (global as unknown as { window: typeof originalWindow }).window = originalWindow;
    }
    if (originalDocument) {
      (global as unknown as { document: typeof originalDocument }).document = originalDocument;
    }
    if (originalRequestAnimationFrame) {
      (global as unknown as { requestAnimationFrame: typeof originalRequestAnimationFrame }).requestAnimationFrame = originalRequestAnimationFrame;
    }
  });

  describe('getPersistedSavePromptState', () => {
    it('should return null when no state is persisted', async () => {
      const state = await getPersistedSavePromptState();
      expect(state).toBeNull();
    });
  });

  describe('restoreSavePromptFromState', () => {
    it('should restore prompt and make it visible', async () => {
      const persistedState: SavePromptPersistedState = {
        login: mockLogin,
        remainingTimeMs: 8000,
        initialAutoDismissMs: 15000,
        savedAt: Date.now(),
        domain: 'example.com',
      };

      await restoreSavePromptFromState(
        container,
        persistedState,
        onSave,
        onNeverSave,
        onDismiss
      );

      expect(isSavePromptVisible()).toBe(true);
    });

    it('should display the correct username in restored prompt', async () => {
      const persistedState: SavePromptPersistedState = {
        login: mockLogin,
        remainingTimeMs: 8000,
        initialAutoDismissMs: 15000,
        savedAt: Date.now(),
        domain: 'example.com',
      };

      await restoreSavePromptFromState(
        container,
        persistedState,
        onSave,
        onNeverSave,
        onDismiss
      );

      const usernameSpan = container.querySelector('.av-save-prompt__username');
      expect(usernameSpan?.textContent).toBe('testuser@example.com');
    });

    it('should auto-dismiss after remaining time expires', async () => {
      const persistedState: SavePromptPersistedState = {
        login: mockLogin,
        remainingTimeMs: 5000, // 5 seconds
        initialAutoDismissMs: 15000,
        savedAt: Date.now(),
        domain: 'example.com',
      };

      await restoreSavePromptFromState(
        container,
        persistedState,
        onSave,
        onNeverSave,
        onDismiss
      );

      expect(isSavePromptVisible()).toBe(true);

      // Fast-forward 5 seconds
      vi.advanceTimersByTime(5000);

      // Should have dismissed and called onDismiss
      expect(onDismiss).toHaveBeenCalled();
    });

    it('should call onSave with correct data when save button clicked', async () => {
      const persistedState: SavePromptPersistedState = {
        login: mockLogin,
        remainingTimeMs: 8000,
        initialAutoDismissMs: 15000,
        savedAt: Date.now(),
        domain: 'example.com',
      };

      await restoreSavePromptFromState(
        container,
        persistedState,
        onSave,
        onNeverSave,
        onDismiss
      );

      const saveBtn = container.querySelector('.av-save-prompt__btn--save') as HTMLButtonElement;
      saveBtn?.click();

      expect(onSave).toHaveBeenCalledWith(mockLogin, 'Example Site');
    });

    it('should set countdown bar width to reflect remaining time percentage', async () => {
      const persistedState: SavePromptPersistedState = {
        login: mockLogin,
        remainingTimeMs: 7500, // 50% of 15000
        initialAutoDismissMs: 15000,
        savedAt: Date.now(),
        domain: 'example.com',
      };

      await restoreSavePromptFromState(
        container,
        persistedState,
        onSave,
        onNeverSave,
        onDismiss
      );

      const countdownBar = container.querySelector('.av-save-prompt__countdown-bar') as HTMLElement;
      // Initial width should be 50%
      expect(countdownBar?.style.width).toBe('50%');
    });
  });

  describe('removeSavePrompt behavior', () => {
    it('should remove the prompt from DOM when clearPersisted is false', async () => {
      await showSavePrompt(container, {
        login: mockLogin,
        onSave,
        onNeverSave,
        onDismiss,
        autoDismissMs: 10000,
      });

      removeSavePrompt(false);

      // Wait for animation to complete (200ms in removeSavePrompt)
      vi.advanceTimersByTime(250);

      // Prompt should be removed from DOM
      expect(isSavePromptVisible()).toBe(false);
    });
  });

  describe('timer continuation across navigations', () => {
    it('should continue timer from where it left off after restore', async () => {
      const persistedState: SavePromptPersistedState = {
        login: mockLogin,
        remainingTimeMs: 8000, // 8 seconds remaining
        initialAutoDismissMs: 15000,
        savedAt: Date.now(), // Just saved, no time elapsed
        domain: 'example.com',
      };

      await restoreSavePromptFromState(
        container,
        persistedState,
        onSave,
        onNeverSave,
        onDismiss
      );

      // Should not dismiss after 6 seconds (less than 8 remaining)
      vi.advanceTimersByTime(6000);
      expect(isSavePromptVisible()).toBe(true);
      expect(onDismiss).not.toHaveBeenCalled();

      // Should dismiss after another 2+ seconds (total 8+)
      vi.advanceTimersByTime(2500);
      expect(onDismiss).toHaveBeenCalled();
    });
  });
});
