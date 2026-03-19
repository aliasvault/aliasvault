import { describe, expect, it } from 'vitest';

import { FormDetector } from '../FormDetector';

import { FormField, testField, createTestDom } from './TestUtils';

describe('FormDetector English tests', () => {
  it('contains tests for English form field detection', () => {
    /**
     * This test suite uses testField() and testBirthdateFormat() helper functions
     * to test form field detection for multiple English registration forms.
     * The actual test implementations are in the helper functions.
     * This test is just to ensure the test suite is working and to satisfy the linter.
     */
    expect(true).toBe(true);
  });

  describe('English registration form 1 detection', () => {
    const htmlFile = 'en-registration-form1.html';

    testField(FormField.Email, 'login', htmlFile);
    testField(FormField.Password, 'password', htmlFile);
  });

  describe('English registration form 2 detection', () => {
    const htmlFile = 'en-registration-form2.html';

    testField(FormField.Email, 'signup-email-input', htmlFile);
    testField(FormField.FirstName, 'signup-name-input', htmlFile);
  });

  describe('English registration form 3 detection', () => {
    const htmlFile = 'en-registration-form3.html';

    testField(FormField.Email, 'email', htmlFile);
    testField(FormField.EmailConfirm, 'reenter_email', htmlFile);
  });

  describe('English registration form 4 detection', () => {
    const htmlFile = 'en-registration-form4.html';

    testField(FormField.Email, 'fbclc_userName', htmlFile);
    testField(FormField.EmailConfirm, 'fbclc_emailConf', htmlFile);
    testField(FormField.Password, 'fbclc_pwd', htmlFile);
    testField(FormField.PasswordConfirm, 'fbclc_pwdConf', htmlFile);
    testField(FormField.FirstName, 'fbclc_fName', htmlFile);
    testField(FormField.LastName, 'fbclc_lName', htmlFile);
  });

  describe('English registration form 5 detection', () => {
    const htmlFile = 'en-registration-form5.html';

    testField(FormField.Username, 'aliasvault-input-7owmnahd9', htmlFile);
    testField(FormField.Password, 'aliasvault-input-ienw3qgxv', htmlFile);
  });

  describe('English registration form 6 detection', () => {
    const htmlFile = 'en-registration-form6.html';

    testField(FormField.FirstName, 'id_first_name', htmlFile);
    testField(FormField.LastName, 'id_last_name', htmlFile);
  });

  describe('English registration form 7 detection', () => {
    const htmlFile = 'en-registration-form7.html';

    testField(FormField.FullName, 'form-group--2', htmlFile);
    testField(FormField.Email, 'form-group--4', htmlFile);
  });

  describe('English email form 1 detection', () => {
    const htmlFile = 'en-email-form1.html';

    testField(FormField.Email, 'P0-0', htmlFile);
  });

  describe('English login form 1 detection', () => {
    const htmlFile = 'en-login-form1.html';

    testField(FormField.Email, 'resolving_input', htmlFile);
  });

  describe('English login form 2 detection', () => {
    const htmlFile = 'en-login-form2.html';

    testField(FormField.Email, 'account_name_text_field', htmlFile);
  });

  describe('English registration form 8 detection (Roblox-style birthdate)', () => {
    const htmlFile = 'en-registration-form8.html';

    testField(FormField.BirthMonth, 'MonthDropdown', htmlFile);
    testField(FormField.BirthDay, 'DayDropdown', htmlFile);
    testField(FormField.BirthYear, 'YearDropdown', htmlFile);
  });

  describe('French login form 1 detection (France Tax Authority)', () => {
    const htmlFile = 'fr-login-form1.html';

    testField(FormField.Username, 'spi_tmp', htmlFile);
  });

  describe('English passwordless signup form 1 detection', () => {
    const htmlFile = 'en-signup-passwordless-1.html';

    testField(FormField.FullName, 'form-group--1', htmlFile);
    testField(FormField.Email, 'form-group--3', htmlFile);
  });

  describe('English passwordless login form 1 detection', () => {
    const htmlFile = 'en-login-passwordless-1.html';

    testField(FormField.Email, 'form-group--1', htmlFile);
  });

  describe('English login form 3 detection (Emby Connect)', () => {
    const htmlFile = 'en-login-form3.html';

    testField(FormField.Email, 'embyinput0', htmlFile);
    testField(FormField.Password, 'embyinput1', htmlFile);

    it('should detect login form', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;
      const formDetector = new FormDetector(document);
      expect(formDetector.containsLoginForm()).toBe(true);
    });

    it('should ignore hidden fake username/password fields with height:0', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const emailInput = document.getElementById('embyinput0');
      const formDetector = new FormDetector(document, emailInput as HTMLElement);
      const form = formDetector.getForm();

      expect(form).toBeTruthy();
      expect(form?.emailField).toBeTruthy();
      expect(form?.emailField?.className).toContain('txtUser');
      expect(form?.emailField?.id).toBe('embyinput0');
      expect(form?.passwordField).toBeTruthy();
      expect(form?.passwordField?.className).toContain('txtPassword');
      expect(form?.passwordField?.name).not.toBe('fakepasswordremembered');
    });

    it('should not autofill hidden fake fields', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const fakeUsernameInput = document.querySelector('input[name="fakeusernameremembered"]');
      const formDetector = new FormDetector(document, fakeUsernameInput as HTMLElement);

      expect(formDetector.isAutofillTriggerableField()).toBe(false);
    });

    it('should detect real username field when clicked', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const usernameInput = document.getElementById('embyinput0');
      const formDetector = new FormDetector(document, usernameInput as HTMLElement);

      expect(formDetector.isAutofillTriggerableField()).toBe(true);
    });

    it('should detect real password field when clicked', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const passwordInput = document.getElementById('embyinput1');
      const formDetector = new FormDetector(document, passwordInput as HTMLElement);

      expect(formDetector.isAutofillTriggerableField()).toBe(true);
    });
  });

  describe('English login form 4 detection (Emby Connect - Swedish)', () => {
    const htmlFile = 'en-login-form4.html';

    testField(FormField.Email, 'embyinput0', htmlFile);
    testField(FormField.Password, 'embyinput1', htmlFile);

    it('should detect login form with Swedish labels', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;
      const formDetector = new FormDetector(document);
      expect(formDetector.containsLoginForm()).toBe(true);
    });

    it('should detect Swedish "E-post" label as email field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const emailInput = document.getElementById('embyinput0');
      const formDetector = new FormDetector(document, emailInput as HTMLElement);
      const form = formDetector.getForm();

      expect(form).toBeTruthy();
      expect(form?.emailField).toBeTruthy();
      expect(form?.emailField?.id).toBe('embyinput0');
      expect(form?.emailField?.className).toContain('txtUser');
    });

    it('should detect Swedish "Lösenord" label as password field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const passwordInput = document.getElementById('embyinput1');
      const formDetector = new FormDetector(document, passwordInput as HTMLElement);
      const form = formDetector.getForm();

      expect(form).toBeTruthy();
      expect(form?.passwordField).toBeTruthy();
      expect(form?.passwordField?.id).toBe('embyinput1');
      expect(form?.passwordField?.className).toContain('txtPassword');
    });

    it('should ignore hidden fake fields in Swedish form', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const emailInput = document.getElementById('embyinput0');
      const formDetector = new FormDetector(document, emailInput as HTMLElement);
      const form = formDetector.getForm();

      expect(form).toBeTruthy();
      expect(form?.emailField?.name).not.toBe('fakeusernameremembered');
      expect(form?.passwordField?.name).not.toBe('fakepasswordremembered');
    });

    it('should not trigger autofill on fake Swedish form fields', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const fakeField = document.querySelector('input[name="fakeusernameremembered"]');
      const formDetector = new FormDetector(document, fakeField as HTMLElement);

      expect(formDetector.isAutofillTriggerableField()).toBe(false);
    });

    it('should trigger autofill on real Swedish email field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const emailInput = document.getElementById('embyinput0');
      const formDetector = new FormDetector(document, emailInput as HTMLElement);

      expect(formDetector.isAutofillTriggerableField()).toBe(true);
    });

    it('should trigger autofill on real Swedish password field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const passwordInput = document.getElementById('embyinput1');
      const formDetector = new FormDetector(document, passwordInput as HTMLElement);

      expect(formDetector.isAutofillTriggerableField()).toBe(true);
    });
  });

});
