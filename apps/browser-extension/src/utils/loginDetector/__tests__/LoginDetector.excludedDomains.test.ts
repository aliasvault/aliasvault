import { describe, it, expect, afterEach, vi } from 'vitest';

import { LoginDetector } from '../LoginDetector';

import { createTestEnvironment, cleanupTestEnvironment, setGlobalWindow } from './TestUtils';

describe('LoginDetector excluded domains', () => {
  let detector: LoginDetector;

  afterEach(() => {
    if (detector) {
      detector.destroy();
    }
    cleanupTestEnvironment();
  });

  const excludedUrls = [
    'https://aliasvault.net/login',
    'https://subdomain.aliasvault.net/login',
  ];

  excludedUrls.forEach((url) => {
    it(`should skip ${url}`, () => {
      const { document, window } = createTestEnvironment(
        `<html><body>
          <form>
            <input type="text" value="user">
            <input type="password" value="pass">
          </form>
        </body></html>`,
        url
      );
      setGlobalWindow(window);

      detector = new LoginDetector(document);
      detector.initialize();

      const callback = vi.fn();
      detector.onLoginCapture(callback);

      const form = document.querySelector('form');
      form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

      vi.runAllTimers();
      expect(callback).not.toHaveBeenCalled();
    });
  });
});

describe('LoginDetector av-disable attribute', () => {
  let detector: LoginDetector;

  afterEach(() => {
    if (detector) {
      detector.destroy();
    }
    cleanupTestEnvironment();
  });

  it('should skip when av-disable="true" is set on body', () => {
    const { document, window } = createTestEnvironment(
      `<html><body av-disable="true">
        <form>
          <input type="text" value="user">
          <input type="password" value="pass">
        </form>
      </body></html>`
    );
    setGlobalWindow(window);

    detector = new LoginDetector(document);
    detector.initialize();

    const callback = vi.fn();
    detector.onLoginCapture(callback);

    const form = document.querySelector('form');
    form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

    vi.runAllTimers();
    expect(callback).not.toHaveBeenCalled();
  });

  it('should skip when av-disable="true" is set on html element', () => {
    const { document, window } = createTestEnvironment(
      `<html av-disable="true"><body>
        <form>
          <input type="text" value="user">
          <input type="password" value="pass">
        </form>
      </body></html>`
    );
    setGlobalWindow(window);

    detector = new LoginDetector(document);
    detector.initialize();

    const callback = vi.fn();
    detector.onLoginCapture(callback);

    const form = document.querySelector('form');
    form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

    vi.runAllTimers();
    expect(callback).not.toHaveBeenCalled();
  });

  it('should not skip when av-disable is not set', () => {
    const { document, window } = createTestEnvironment(
      `<html><body>
        <form>
          <input type="text" value="user">
          <input type="password" value="pass">
        </form>
      </body></html>`
    );
    setGlobalWindow(window);

    detector = new LoginDetector(document);
    detector.initialize();

    const callback = vi.fn();
    detector.onLoginCapture(callback);

    const form = document.querySelector('form');
    form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

    vi.runAllTimers();
    expect(callback).toHaveBeenCalled();
  });

  it('should not skip when av-disable="false"', () => {
    const { document, window } = createTestEnvironment(
      `<html><body av-disable="false">
        <form>
          <input type="text" value="user">
          <input type="password" value="pass">
        </form>
      </body></html>`
    );
    setGlobalWindow(window);

    detector = new LoginDetector(document);
    detector.initialize();

    const callback = vi.fn();
    detector.onLoginCapture(callback);

    const form = document.querySelector('form');
    form?.dispatchEvent(new window.Event('submit', { bubbles: true }));

    vi.runAllTimers();
    expect(callback).toHaveBeenCalled();
  });
});
