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

  describe('English login form 5 detection (Tailwind, no form wrapper, placeholder-only labels)', () => {
    const htmlFile = 'en-login-form5.html';

    testField(FormField.Username, 'username-input', htmlFile);
    testField(FormField.Password, 'password-input', htmlFile);
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

  describe('French login form 2 detection (Plurilogic password page)', () => {
    const htmlFile = 'fr-login-form2.html';

    testField(FormField.Password, 'MotPasse', htmlFile);

    it('should not misclassify the password field as TOTP', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;
      const focusedElement = document.getElementById('MotPasse');
      const formDetector = new FormDetector(document, focusedElement);
      const result = formDetector.getForm();
      expect(result?.totpField).toBeNull();
    });
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

  /*
   * Regression: a field declared as <input type="password"> must be detected
   * as a password field even when its id/name/placeholder don't include the
   * strings "password"/"pwd"/"pass" (e.g. intranet forms using "pin",
   * "loginPin", etc.). The HTML standard type attribute is an unambiguous
   * signal that should be respected.
   */
  describe('English login form with type="password" but no password keyword in id/name', () => {
    const htmlFile = 'en-login-form-typed-password.html';

    testField(FormField.Username, 'loginUser', htmlFile);
    testField(FormField.Password, 'loginPin', htmlFile);

    it('should detect the form as a login form', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;
      const formDetector = new FormDetector(document);
      expect(formDetector.containsLoginForm()).toBe(true);
    });

    it('should trigger autofill when clicking the type="password" field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const pinInput = document.getElementById('loginPin');
      const formDetector = new FormDetector(document, pinInput as HTMLElement);

      expect(formDetector.isAutofillTriggerableField()).toBe(true);
    });

    it('should expose the type="password" field as the primary password field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const pinInput = document.getElementById('loginPin');
      const formDetector = new FormDetector(document, pinInput as HTMLElement);
      const form = formDetector.getForm();

      expect(form).toBeTruthy();
      expect(form?.passwordField).toBeTruthy();
      expect(form?.passwordField?.id).toBe('loginPin');
      expect(form?.passwordField?.type).toBe('password');
      expect(form?.passwordConfirmField).toBeFalsy();
    });
  });

  /*
   * Login form popup 1 detection.
   */
  describe('English login form popup 1 detection', () => {
    const htmlFile = 'en-login-form-popup1.html';

    testField(FormField.Email, 'Form_Email', htmlFile);
    testField(FormField.Password, 'Form_Password', htmlFile);

    it('should detect the popup form as a login form', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const emailInput = document.getElementById('Form_Email');
      const formDetector = new FormDetector(document, emailInput as HTMLElement);
      expect(formDetector.containsLoginForm()).toBe(true);
    });

    it('should trigger autofill when clicking the Email/Username field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const emailInput = document.getElementById('Form_Email');
      const formDetector = new FormDetector(document, emailInput as HTMLElement);
      expect(formDetector.isAutofillTriggerableField()).toBe(true);
    });

    it('should trigger autofill when clicking the password field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const passwordInput = document.getElementById('Form_Password');
      const formDetector = new FormDetector(document, passwordInput as HTMLElement);
      expect(formDetector.isAutofillTriggerableField()).toBe(true);
    });

    it('should not autofill the hidden honeypot/system fields', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const emailInput = document.getElementById('Form_Email');
      const formDetector = new FormDetector(document, emailInput as HTMLElement);
      const form = formDetector.getForm();

      expect(form?.emailField?.id).toBe('Form_Email');
      expect(form?.passwordField?.id).toBe('Form_Password');
      expect(form?.usernameField?.id).not.toBe('Form_ClientHour');
    });
  });

  /*
   * Counterpart to the test above: when type="password" is (mis)used to mask
   * an OTP/2FA input, the password detector must NOT classify it as a
   * credential password (otherwise the master password would be autofilled
   * into a TOTP field), and the TOTP detector should pick it up so the
   * user still gets a meaningful autofill experience.
   */
  describe('English form with type="password" masked TOTP input', () => {
    const htmlFile = 'en-totp-masked-as-password.html';

    it('should NOT classify the type="password" OTP field as a credential password', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const otpInput = document.getElementById('otp');
      const formDetector = new FormDetector(document, otpInput as HTMLElement);
      const form = formDetector.getForm();

      expect(form?.passwordField).toBeFalsy();
      expect(form?.passwordConfirmField).toBeFalsy();
    });

    it('should classify the type="password" OTP field as a TOTP field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const otpInput = document.getElementById('otp');
      const formDetector = new FormDetector(document, otpInput as HTMLElement);
      const form = formDetector.getForm();

      expect(form?.totpField).toBeTruthy();
      expect(form?.totpField?.id).toBe('otp');
      expect(form?.totpField?.type).toBe('password');
    });

    it('should trigger autofill when clicking the masked OTP field', () => {
      const dom = createTestDom(htmlFile);
      const document = dom.window.document;

      const otpInput = document.getElementById('otp');
      const formDetector = new FormDetector(document, otpInput as HTMLElement);

      expect(formDetector.isAutofillTriggerableField()).toBe(true);
    });
  });

});
