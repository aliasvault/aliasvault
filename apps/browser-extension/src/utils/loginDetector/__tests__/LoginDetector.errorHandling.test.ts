import { describe, it, expect, afterEach, vi } from 'vitest';

import { LoginDetector } from '../LoginDetector';

import { createTestEnvironment, cleanupTestEnvironment, setGlobalWindow } from './TestUtils';

describe('LoginDetector error handling', () => {
  let detector: LoginDetector;

  afterEach(() => {
    if (detector) {
      detector.destroy();
    }
    cleanupTestEnvironment();
  });

  it('should continue calling other callbacks even if one throws', () => {
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

    const errorCallback = vi.fn().mockImplementation(() => {
      throw new Error('Callback error');
    });
    const successCallback = vi.fn();

    // Spy on console.error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    detector.onLoginCapture(errorCallback);
    detector.onLoginCapture(successCallback);

    const form = document.querySelector('form');
    form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

    vi.runAllTimers();

    expect(errorCallback).toHaveBeenCalledTimes(1);
    expect(successCallback).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
