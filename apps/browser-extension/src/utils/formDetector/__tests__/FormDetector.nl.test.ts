import { describe, it, expect } from 'vitest';

import { FormDetector } from '../FormDetector';

import { FormField, testField, testBirthdateFormat, createTestDom } from './TestUtils';

describe('FormDetector Dutch tests', () => {
  it('contains tests for Dutch form field detection', () => {
    /**
     * This test suite uses testField() and testBirthdateFormat() helper functions
     * to test form field detection for multiple Dutch registration forms.
     * The actual test implementations are in the helper functions.
     * This test is just to ensure the test suite is working and to satisfy the linter.
     */
    expect(true).toBe(true);
  });

  describe('Dutch registration form detection', () => {
    const htmlFile = 'nl-registration-form1.html';

    testField(FormField.LastName, 'cpContent_txtAchternaam', htmlFile);
    testField(FormField.Email, 'cpContent_txtEmail', htmlFile);
    testField(FormField.Password, 'cpContent_txtWachtwoord', htmlFile);
    testField(FormField.PasswordConfirm, 'cpContent_txtWachtwoord2', htmlFile);
  });

  describe('Dutch registration form 2 detection', () => {
    const htmlFile = 'nl-registration-form2.html';

    testField(FormField.Username, 'register-username', htmlFile);
    testField(FormField.Email, 'register-email', htmlFile);
    testField(FormField.Password, 'register-password', htmlFile);

    testField(FormField.BirthDay, 'register-day', htmlFile);
    testField(FormField.BirthMonth, 'register-month', htmlFile);
    testField(FormField.BirthYear, 'register-year', htmlFile);

    testField(FormField.GenderMale, 'man', htmlFile);
    testField(FormField.GenderFemale, 'vrouw', htmlFile);
    testField(FormField.GenderOther, 'iets', htmlFile);
  });

  describe('Dutch registration form 3 detection', () => {
    const htmlFile = 'nl-registration-form3.html';

    testField(FormField.FirstName, 'firstName', htmlFile);
    testField(FormField.LastName, 'lastName', htmlFile);
    testField(FormField.Password, 'password', htmlFile);

    testField(FormField.BirthDate, 'date', htmlFile);
    testBirthdateFormat('dd-mm-yyyy', htmlFile, 'date');
    testField(FormField.GenderMale, 'gender1', htmlFile);
    testField(FormField.GenderFemale, 'gender2', htmlFile);
    testField(FormField.GenderOther, 'gender3', htmlFile);
  });

  describe('Dutch registration form 4 detection', () => {
    const htmlFile = 'nl-registration-form4.html';

    testField(FormField.Email, 'EmailAddress', htmlFile);
  });

  describe('Dutch registration form 5 detection', () => {
    const htmlFile = 'nl-registration-form5.html';

    testField(FormField.Email, 'input_25_5', htmlFile);
    testField(FormField.Gender, 'input_25_13', htmlFile);
    testField(FormField.FirstName, 'input_25_14', htmlFile);
    testField(FormField.LastName, 'input_25_15', htmlFile);
    testField(FormField.BirthDate, 'input_25_10', htmlFile);
    testBirthdateFormat('dd/mm/yyyy', htmlFile, 'input_25_10');
  });

  describe('Dutch registration form 6 detection', () => {
    const htmlFile = 'nl-registration-form6.html';

    testField(FormField.Email, 'field18478', htmlFile);
    testField(FormField.FirstName, 'field18479', htmlFile);
    testField(FormField.LastName, 'field18486', htmlFile);
  });

  describe('Dutch registration form 7 detection', () => {
    const htmlFile = 'nl-registration-form7.html';

    testField(FormField.Email, 'Form_EmailAddress', htmlFile);
    testField(FormField.FirstName, 'Form_Firstname', htmlFile);
    testField(FormField.LastName, 'Form_Lastname', htmlFile);
    testField(FormField.Password, 'Form_Password', htmlFile);
    testField(FormField.PasswordConfirm, 'Form_RepeatPassword', htmlFile);
    testField(FormField.BirthDay, 'Form.Birthdate_d', htmlFile);
    testField(FormField.BirthMonth, 'Form.Birthdate_m', htmlFile);
    testField(FormField.BirthYear, 'Form.Birthdate_y', htmlFile);
  });

  describe('Dutch registration form 8 detection', () => {
    const htmlFile = 'nl-registration-form8.html';

    testField(FormField.FirstName, 'aliasvault-input-name', htmlFile);
    testField(FormField.Email, 'aliasvault-input-email', htmlFile);
    testField(FormField.LastName, 'aliasvault-input-lastname', htmlFile);
  });

  describe('Dutch registration form 9 detection', () => {
    const htmlFile = 'nl-registration-form9.html';

    testField(FormField.Username, 'user_username', htmlFile);
    testField(FormField.Email, 'user_email_address', htmlFile);
    testField(FormField.Password, 'user_password', htmlFile);
    testField(FormField.PasswordConfirm, 'user_password_confirmation', htmlFile);
  });

  describe('Dutch registration form 10 detection', () => {
    const htmlFile = 'nl-registration-form10.html';

    testField(FormField.Email, 'tbxEmail1', htmlFile);
    testField(FormField.EmailConfirm, 'tbxEmail2', htmlFile);
    testField(FormField.FirstName, 'Field645', htmlFile);
    testField(FormField.LastName, 'Field642', htmlFile);
    testField(FormField.BirthDate, 'Field675', htmlFile);
  });

  describe('Dutch login form 1 detection', () => {
    const htmlFile = 'nl-login-form1.html';

    testField(FormField.Username, 'login_form_user', htmlFile);
    testField(FormField.Password, 'login_form_password', htmlFile);

    it('should detect username field despite autocomplete="off"', () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      expect(usernameInput).not.toBeNull();
      expect(usernameInput.getAttribute('autocomplete')).toBe('off');

      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      expect(detectedFields?.usernameField).toBe(usernameInput);
      expect(detectedFields?.usernameField?.id).toBe('login_form_user');
    });

    it('should detect password field with autocomplete="current-password"', () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const passwordInput = doc.getElementById('login_form_password') as HTMLInputElement;
      expect(passwordInput).not.toBeNull();
      expect(passwordInput.getAttribute('autocomplete')).toBe('current-password');

      const formDetector = new FormDetector(doc, passwordInput);
      const detectedFields = formDetector.getForm();

      expect(detectedFields?.passwordField).toBe(passwordInput);
      expect(detectedFields?.passwordField?.id).toBe('login_form_password');
    });

    it('should not detect hidden fields as login fields', () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      const hiddenLocation = doc.getElementById('login_form_location') as HTMLInputElement;
      const hiddenToken = doc.getElementById('login_form__token') as HTMLInputElement;

      expect(detectedFields?.usernameField).not.toBe(hiddenLocation);
      expect(detectedFields?.usernameField).not.toBe(hiddenToken);
      expect(detectedFields?.passwordField).not.toBe(hiddenLocation);
      expect(detectedFields?.passwordField).not.toBe(hiddenToken);
    });

    it('should not detect session option fields as login fields', () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      const sessionNameInput = doc.getElementById('login_form_sessionName') as HTMLInputElement;
      const durationSelect = doc.getElementById('login_form_duration') as HTMLSelectElement;

      expect(detectedFields?.usernameField).not.toBe(sessionNameInput);
      expect(detectedFields?.usernameField).not.toBe(durationSelect);
      expect(detectedFields?.passwordField).not.toBe(sessionNameInput);
    });

    it('should detect both username and password fields from the same form', () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const passwordInput = doc.getElementById('login_form_password') as HTMLInputElement;

      const formDetector = new FormDetector(doc, usernameInput);
      const detectedFields = formDetector.getForm();

      expect(detectedFields?.usernameField).toBe(usernameInput);
      expect(detectedFields?.passwordField).toBe(passwordInput);
    });

    it('should handle form detection when clicking on username field with multiple inputs nearby', () => {
      const dom = createTestDom(htmlFile);
      const doc = dom.window.document;

      const usernameInput = doc.getElementById('login_form_user') as HTMLInputElement;
      const formDetector = new FormDetector(doc, usernameInput);

      expect(formDetector.containsLoginForm()).toBe(true);

      const detectedFields = formDetector.getForm();

      expect(detectedFields?.usernameField).toBeTruthy();
      expect(detectedFields?.passwordField).toBeTruthy();
      expect(detectedFields?.emailField).toBeFalsy();
      expect(detectedFields?.passwordConfirmField).toBeFalsy();
    });
  });
});
