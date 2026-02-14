import { JSDOM } from 'jsdom';
import { vi } from 'vitest';

/**
 * Mock MutationObserver for tests.
 */
export class MockMutationObserver {
  private callback: MutationCallback;
  private target: Node | null = null;

  /**
   * Creates a new MockMutationObserver instance.
   * @param callback - The callback function to be invoked when mutations occur.
   */
  public constructor(callback: MutationCallback) {
    this.callback = callback;
  }

  /**
   * Starts observing the target node for mutations.
   * @param target - The target node to observe.
   * @param _options - Configuration options for the observer.
   */
  public observe(target: Node, _options?: MutationObserverInit): void {
    this.target = target;
    // Store the observer for potential mutation triggering
    (target as unknown as { __mutationObserver: MockMutationObserver }).__mutationObserver = this;
  }

  /**
   * Stops observing mutations.
   */
  public disconnect(): void {
    if (this.target) {
      delete (this.target as unknown as { __mutationObserver?: MockMutationObserver }).__mutationObserver;
    }
    this.target = null;
  }

  /**
   * Returns an empty list of pending mutation records.
   * @returns Empty array of MutationRecords.
   */
  public takeRecords(): MutationRecord[] {
    return [];
  }

  /**
   * Trigger the mutation callback with synthetic mutations.
   * @param mutations - The mutations to trigger.
   */
  public trigger(mutations: Partial<MutationRecord>[]): void {
    this.callback(mutations as MutationRecord[], this);
  }
}

// Set up global MutationObserver mock
(global as unknown as { MutationObserver: typeof MockMutationObserver }).MutationObserver = MockMutationObserver;

/**
 * Test environment containing dom, window, and document.
 */
export interface ITestEnvironment {
  dom: JSDOM;
  window: JSDOM['window'];
  document: Document;
}

/**
 * Helper to create a JSDOM instance with proper window mocks for testing.
 * @param html - The HTML content to use for the document.
 * @param url - The URL to use for the document location.
 * @returns The test environment with dom, window, and document.
 */
export const createTestEnvironment = (
  html: string,
  url: string = 'https://example.com/login'
): ITestEnvironment => {
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    resources: 'usable',
  });

  const { window } = dom;
  const { document } = window;

  // Mock MutationObserver on the window
  (window as unknown as { MutationObserver: typeof MockMutationObserver }).MutationObserver = MockMutationObserver;

  // Mock getComputedStyle for visibility checks
  window.getComputedStyle = vi.fn().mockImplementation((element: HTMLElement) => ({
    display: element.style.display || 'block',
    visibility: element.style.visibility || 'visible',
    opacity: element.style.opacity || '1',
  }));

  // Mock setTimeout/clearTimeout
  vi.useFakeTimers();

  return { dom, window, document };
};

/**
 * Helper to clean up test environment.
 */
export const cleanupTestEnvironment = (): void => {
  vi.useRealTimers();
  vi.restoreAllMocks();
};

/**
 * Sets up the global window reference for tests.
 * @param window - The JSDOM window to set as global.
 */
export const setGlobalWindow = (window: JSDOM['window']): void => {
  (global as unknown as { window: typeof window }).window = window;
};

/**
 * Sets up global HTML element constructors for instanceof checks.
 * @param window - The JSDOM window to use for element constructors.
 */
export const setGlobalHTMLElements = (window: JSDOM['window']): void => {
  (global as unknown as { HTMLFormElement: typeof window.HTMLFormElement }).HTMLFormElement = window.HTMLFormElement;
  (global as unknown as { HTMLElement: typeof window.HTMLElement }).HTMLElement = window.HTMLElement;
};
