import { describe, it, expect, afterEach, vi } from 'vitest';

import { LoginDetector } from '../LoginDetector';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setGlobalWindow,
  setGlobalHTMLElements,
  MockMutationObserver,
} from './TestUtils';

describe('LoginDetector dynamic form monitoring', () => {
  let detector: LoginDetector;

  afterEach(() => {
    if (detector) {
      detector.destroy();
    }
    cleanupTestEnvironment();
  });

  it('should monitor dynamically added forms when MutationObserver triggers', () => {
    const { document, window } = createTestEnvironment(`
      <html><body></body></html>
    `);

    setGlobalHTMLElements(window);
    setGlobalWindow(window);

    detector = new LoginDetector(document);
    detector.initialize();

    const callback = vi.fn();
    detector.onLoginCapture(callback);

    // Dynamically add a form
    const form = document.createElement('form');
    form.innerHTML = `
      <input type="text" id="username" value="dynamicuser">
      <input type="password" id="password" value="dynamicpass">
      <button type="submit">Login</button>
    `;
    document.body.appendChild(form);

    // Get the MutationObserver and trigger it manually with the new form
    const observer = (document.body as unknown as { __mutationObserver: MockMutationObserver }).__mutationObserver;
    if (observer) {
      observer.trigger([{
        type: 'childList',
        addedNodes: [form] as unknown as NodeList,
        removedNodes: [] as unknown as NodeList,
        target: document.body,
        previousSibling: null,
        nextSibling: null,
        attributeName: null,
        attributeNamespace: null,
        oldValue: null,
      }]);
    }

    vi.runAllTimers();

    // Submit the dynamic form
    form.dispatchEvent(new window.Event('submit', { bubbles: true }));
    vi.runAllTimers();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].username).toBe('dynamicuser');
  });

  it('should not add duplicate listeners to monitored forms', () => {
    const { document, window } = createTestEnvironment(`
      <html><body>
        <form>
          <input type="text" id="username" value="testuser">
          <input type="password" id="password" value="testpass">
          <button type="submit">Login</button>
        </form>
      </body></html>
    `);
    setGlobalWindow(window);

    detector = new LoginDetector(document);
    detector.initialize();

    // Re-trigger form monitoring (should be no-op)
    detector.initialize();

    const callback = vi.fn();
    detector.onLoginCapture(callback);

    const form = document.querySelector('form');
    form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

    vi.runAllTimers();

    // Should only capture once despite potential duplicate initialization
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
