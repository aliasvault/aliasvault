import { JSDOM } from 'jsdom';
import { describe, it, expect, vi } from 'vitest';

import { FormDetector } from '../FormDetector';
import { DetectedFieldType } from '../types/FormFields';

import { createTestDom } from './TestUtils';

describe('FormDetector - Various hidden field techniques', () => {
  const htmlFile = 'hidden-fields-various.html';

  it('should detect login form with real fields', () => {
    const dom = createTestDom(htmlFile);
    const document = dom.window.document;
    const formDetector = new FormDetector(document);
    expect(formDetector.containsLoginForm()).toBe(true);
  });

  it('should ignore fields in height:0 container', () => {
    const dom = createTestDom(htmlFile);
    const document = dom.window.document;

    const realEmail = document.getElementById('real-email');
    const formDetector = new FormDetector(document, realEmail as HTMLElement);
    const form = formDetector.getForm();

    expect(form).toBeTruthy();
    expect(form?.emailField?.id).toBe('real-email');
    expect(form?.passwordField?.id).toBe('real-password');

    // Should not detect fake fields
    expect(form?.emailField?.name).not.toBe('fake1');
    expect(form?.passwordField?.name).not.toBe('fake1pass');
  });

  it('should ignore fields in width:0 container', () => {
    const dom = createTestDom(htmlFile);
    const document = dom.window.document;

    const realEmail = document.getElementById('real-email');
    const formDetector = new FormDetector(document, realEmail as HTMLElement);
    const form = formDetector.getForm();

    expect(form).toBeTruthy();
    expect(form?.emailField?.name).not.toBe('fake2');
    expect(form?.passwordField?.name).not.toBe('fake2pass');
  });

  it('should ignore fields positioned off-screen', () => {
    const dom = createTestDom(htmlFile);
    const document = dom.window.document;

    const realEmail = document.getElementById('real-email');
    const formDetector = new FormDetector(document, realEmail as HTMLElement);
    const form = formDetector.getForm();

    expect(form).toBeTruthy();
    expect(form?.emailField?.name).not.toBe('fake3');
    expect(form?.passwordField?.name).not.toBe('fake3pass');
  });

  describe('position:fixed field inside an off-screen container', () => {
    /**
     * Build a login form whose fields sit in a fixed box inside an off-screen ancestor.
     */
    const createDocument = (): Document => new JSDOM(`
      <div style="position:absolute; left:-9999px;">
        <form style="position:fixed; top:0; left:0;">
          <label for="email">Email</label><input type="email" id="email">
          <label for="password">Password</label><input type="password" id="password">
        </form>
      </div>`).window.document;

    it('should treat the field as visible when the fixed box escapes the off-screen ancestor', () => {
      const document = createDocument();
      const formDetector = new FormDetector(document, document.getElementById('password') as HTMLElement);

      expect(formDetector.getDetectedFieldType()).toBe(DetectedFieldType.Password);
    });

    it('should treat the field as hidden when the fixed box still renders off-screen', () => {
      const document = createDocument();
      // Simulate an ancestor (e.g. with a transform) that captures the fixed box; jsdom has no layout.
      vi.spyOn(document.querySelector('form')!, 'getBoundingClientRect').mockReturnValue({ left: -9999, top: 0 } as DOMRect);
      const formDetector = new FormDetector(document, document.getElementById('password') as HTMLElement);

      expect(formDetector.getDetectedFieldType()).toBeNull();
    });
  });

  it('should ignore honeypot fields', () => {
    const dom = createTestDom(htmlFile);
    const document = dom.window.document;

    const realEmail = document.getElementById('real-email');
    const formDetector = new FormDetector(document, realEmail as HTMLElement);
    const form = formDetector.getForm();

    expect(form).toBeTruthy();
    expect(form?.emailField?.name).not.toBe('honeypot');
    expect(form?.emailField?.name).not.toBe('hp-field');
    expect(form?.emailField?.name).not.toBe('bot_check');
    expect(form?.emailField?.name).not.toBe('antispam-field');
  });

  it('should ignore fields with aria-hidden="true"', () => {
    const dom = createTestDom(htmlFile);
    const document = dom.window.document;

    const realEmail = document.getElementById('real-email');
    const formDetector = new FormDetector(document, realEmail as HTMLElement);
    const form = formDetector.getForm();

    expect(form).toBeTruthy();
    expect(form?.emailField?.name).not.toBe('hidden-username');
    expect(form?.passwordField?.name).not.toBe('hidden-password');
  });

  it('should ignore fields with role="presentation"', () => {
    const dom = createTestDom(htmlFile);
    const document = dom.window.document;

    const realEmail = document.getElementById('real-email');
    const formDetector = new FormDetector(document, realEmail as HTMLElement);
    const form = formDetector.getForm();

    expect(form).toBeTruthy();
    expect(form?.emailField?.name).not.toBe('presentation-field');
  });

  it('should not trigger autofill on fake field with tabindex=-1', () => {
    const dom = createTestDom(htmlFile);
    const document = dom.window.document;

    const fakeField = document.querySelector('input[name="fake1"]');
    const formDetector = new FormDetector(document, fakeField as HTMLElement);

    expect(formDetector.isAutofillTriggerableField()).toBe(false);
  });

  it('should not trigger autofill on honeypot field', () => {
    const dom = createTestDom(htmlFile);
    const document = dom.window.document;

    const honeypotField = document.querySelector('input[name="honeypot"]');
    const formDetector = new FormDetector(document, honeypotField as HTMLElement);

    expect(formDetector.isAutofillTriggerableField()).toBe(false);
  });

  it('should trigger autofill on real email field', () => {
    const dom = createTestDom(htmlFile);
    const document = dom.window.document;

    const realEmail = document.getElementById('real-email');
    const formDetector = new FormDetector(document, realEmail as HTMLElement);

    expect(formDetector.isAutofillTriggerableField()).toBe(true);
  });

  it('should trigger autofill on real password field', () => {
    const dom = createTestDom(htmlFile);
    const document = dom.window.document;

    const realPassword = document.getElementById('real-password');
    const formDetector = new FormDetector(document, realPassword as HTMLElement);

    expect(formDetector.isAutofillTriggerableField()).toBe(true);
  });
});
