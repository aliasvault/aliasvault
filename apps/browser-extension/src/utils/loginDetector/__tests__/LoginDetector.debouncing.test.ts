import { describe, it, expect, afterEach, vi } from 'vitest';

import { LoginDetector } from '../LoginDetector';

import { createTestEnvironment, cleanupTestEnvironment, setGlobalWindow } from './TestUtils';

describe('LoginDetector debouncing', () => {
  let detector: LoginDetector;

  afterEach(() => {
    if (detector) {
      detector.destroy();
    }
    cleanupTestEnvironment();
  });

  it('should debounce duplicate submissions within 5 seconds', () => {
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

    const callback = vi.fn();
    detector.onLoginCapture(callback);

    const form = document.querySelector('form');

    // First submission
    form?.dispatchEvent(new window.Event('submit', { bubbles: true }));
    vi.advanceTimersByTime(100);

    // Second submission (should be debounced)
    form?.dispatchEvent(new window.Event('submit', { bubbles: true }));
    vi.advanceTimersByTime(100);

    // Third submission (should be debounced)
    form?.dispatchEvent(new window.Event('submit', { bubbles: true }));
    vi.advanceTimersByTime(100);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should allow new submission with different password', () => {
    const { document, window } = createTestEnvironment(`
      <html><body>
        <form>
          <input type="text" id="username" value="testuser">
          <input type="password" id="password" value="firstpass">
          <button type="submit">Login</button>
        </form>
      </body></html>
    `);
    setGlobalWindow(window);

    detector = new LoginDetector(document);
    detector.initialize();

    const callback = vi.fn();
    detector.onLoginCapture(callback);

    const form = document.querySelector('form');
    const passwordInput = document.getElementById('password') as HTMLInputElement;

    // First submission
    form?.dispatchEvent(new window.Event('submit', { bubbles: true }));
    vi.advanceTimersByTime(100);

    // Change password and submit again
    passwordInput.value = 'secondpass';
    form?.dispatchEvent(new window.Event('submit', { bubbles: true }));
    vi.advanceTimersByTime(100);

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls[0][0].password).toBe('firstpass');
    expect(callback.mock.calls[1][0].password).toBe('secondpass');
  });

  it('should allow submission after 5 seconds have passed', () => {
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

    const callback = vi.fn();
    detector.onLoginCapture(callback);

    const form = document.querySelector('form');

    // First submission
    form?.dispatchEvent(new window.Event('submit', { bubbles: true }));
    vi.advanceTimersByTime(100);

    // Wait 5+ seconds
    vi.advanceTimersByTime(5000);

    // Second submission (should be allowed)
    form?.dispatchEvent(new window.Event('submit', { bubbles: true }));
    vi.advanceTimersByTime(100);

    expect(callback).toHaveBeenCalledTimes(2);
  });
});
