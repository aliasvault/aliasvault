import { describe, expect, it } from 'vitest';

import { isAvAutofillAllowed } from '@/utils/autofill/Autofill';
import { closestAcrossShadow, composedContains, getDeepActiveElement, getDeepElementById, getDeepEventTarget, queryAllDeep } from '@/utils/ShadowDom';

import { FormDetector } from '../FormDetector';

import { createTestDom, FormField, testField } from './TestUtils';

/**
 * Web components that render an entire login form inside a single open shadow root, instead of
 * the one-input-per-custom-element pattern covered by FormDetector.shadowdom.test.ts.
 */
describe('FormDetector shadow-root-hosted form tests', () => {
  describe('Login form with its own form element inside a shadow root', () => {
    const htmlFile = 'shadow-root-1.html';

    testField(FormField.Username, 'username', htmlFile);
    testField(FormField.Password, 'password', htmlFile);

    it('should detect a login form for a field inside the shadow root', () => {
      const document = createTestDom(htmlFile).window.document;
      const username = getDeepElementById(document, 'username');

      expect(new FormDetector(document, username as HTMLElement).containsLoginForm()).toBe(true);
    });

    it('should classify the shadow-hosted password field as a password field', () => {
      const document = createTestDom(htmlFile).window.document;
      const password = getDeepElementById(document, 'password');

      expect(new FormDetector(document, password as HTMLElement).getDetectedFieldType()).toBe('password');
    });

    it('should find the shadow-hosted form and its inputs from the document root', () => {
      const document = createTestDom(htmlFile).window.document;

      expect(queryAllDeep(document, 'form')).toHaveLength(1);
      expect(queryAllDeep(document, 'input').map(input => input.id)).toEqual(['username', 'password']);
    });
  });

  describe('Login form inside a shadow root without a form element', () => {
    const htmlFile = 'shadow-root-2.html';

    testField(FormField.Username, 'username', htmlFile);
    testField(FormField.Password, 'password', htmlFile);

    it('should detect a login form even without a form wrapper', () => {
      const document = createTestDom(htmlFile).window.document;
      const username = getDeepElementById(document, 'username');

      expect(new FormDetector(document, username as HTMLElement).containsLoginForm()).toBe(true);
    });
  });

  describe('Login form whose fields are identified only by their custom element host', () => {
    const htmlFile = 'shadow-root-4.html';

    /**
     * Resolve the real input a component renders inside its shadow root.
     * @param document - The test document.
     * @param hostId - The id of the custom element host.
     * @returns The input inside the host's shadow root.
     */
    const shadowInputOf = (document: Document, hostId: string): HTMLInputElement => {
      const host = document.getElementById(hostId);
      return host!.shadowRoot!.querySelector('input') as HTMLInputElement;
    };

    it('should keep the real inputs out of the normal DOM', () => {
      const document = createTestDom(htmlFile).window.document;

      expect(document.querySelectorAll('input')).toHaveLength(0);
      expect(queryAllDeep(document, 'input')).toHaveLength(2);
    });

    /*
     * Focusing the field hands the detector the input inside the shadow root, which carries nothing
     * but type="text". Everything identifying it — id, name, autocomplete and the slotted
     * "Email or username" label — sits on the host outside the shadow boundary.
     */
    it('should classify the shadow-rendered username field from its host metadata', () => {
      const document = createTestDom(htmlFile).window.document;
      const input = shadowInputOf(document, 'login-username');

      expect(input.getAttribute('name')).toBeNull();

      const detector = new FormDetector(document, input);
      expect(detector.containsLoginForm()).toBe(true);
      expect(detector.getDetectedFieldType()).toBe('username');
    });

    it('should classify the shadow-rendered password field from its host metadata', () => {
      const document = createTestDom(htmlFile).window.document;
      const input = shadowInputOf(document, 'login-password');

      const detector = new FormDetector(document, input);
      expect(detector.containsLoginForm()).toBe(true);
      expect(detector.getDetectedFieldType()).toBe('password');
    });

    it('should still classify the field when the host itself is the clicked element', () => {
      const document = createTestDom(htmlFile).window.document;
      const host = document.getElementById('login-username') as HTMLElement;

      expect(new FormDetector(document, host).getDetectedFieldType()).toBe('username');
    });

    it('should resolve fill targets to the real inputs rather than the custom element hosts', () => {
      const document = createTestDom(htmlFile).window.document;
      const form = new FormDetector(document, shadowInputOf(document, 'login-username')).getForm();

      // "Email or username" matches the email patterns first, so the field lands on emailField.
      expect(form?.emailField).toBe(shadowInputOf(document, 'login-username'));
      expect(form?.passwordField).toBe(shadowInputOf(document, 'login-password'));
    });
  });

  describe('Login form nested two shadow roots deep', () => {
    const htmlFile = 'shadow-root-3.html';

    testField(FormField.Username, 'username', htmlFile);
    testField(FormField.Password, 'password', htmlFile);

    it('should reach inputs inside nested shadow roots from the document root', () => {
      const document = createTestDom(htmlFile).window.document;

      expect(queryAllDeep(document, 'input').map(input => input.id)).toEqual(['username', 'password']);
    });
  });
});

describe('Shadow DOM traversal helper tests', () => {
  const htmlFile = 'shadow-root-1.html';

  it('should resolve the real input from a retargeted focusin event', () => {
    const document = createTestDom(htmlFile).window.document;
    const host = document.querySelector('gramps-jslogin');
    const password = getDeepElementById(document, 'password') as HTMLInputElement;

    let deepTarget: Element | null = null;
    let retargetedTarget: EventTarget | null = null;
    document.addEventListener('focusin', (event) => {
      deepTarget = getDeepEventTarget(event);
      retargetedTarget = event.target;
    });

    password.focus();

    // The event itself is retargeted to the host — which is exactly why the deep lookup is needed.
    expect(retargetedTarget).toBe(host);
    expect(deepTarget).toBe(password);
  });

  it('should descend into the shadow root for the active element', () => {
    const document = createTestDom(htmlFile).window.document;
    const host = document.querySelector('gramps-jslogin');
    const password = getDeepElementById(document, 'password') as HTMLInputElement;

    password.focus();

    expect(document.activeElement).toBe(host);
    expect(getDeepActiveElement(document)).toBe(password);
  });

  it('should cross the shadow boundary for closest() and contains()', () => {
    const document = createTestDom(htmlFile).window.document;
    const host = document.querySelector('gramps-jslogin');
    const username = getDeepElementById(document, 'username') as HTMLInputElement;

    expect(closestAcrossShadow(username, 'form')?.id).toBe('login-form');
    expect(closestAcrossShadow(username, 'body')).toBe(document.body);
    expect(composedContains(host, username)).toBe(true);
    expect(host?.contains(username)).toBe(false);
  });

  it('should honour an av-disable marker on body for fields inside a shadow root', () => {
    const document = createTestDom(htmlFile).window.document;
    const username = getDeepElementById(document, 'username') as HTMLInputElement;

    expect(isAvAutofillAllowed(username)).toBe(true);

    document.body.setAttribute('av-disable', 'true');
    expect(isAvAutofillAllowed(username)).toBe(false);
  });
});
