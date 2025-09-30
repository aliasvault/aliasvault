import { describe, expect, it } from 'vitest';

import { FormField, testField } from './TestUtils';

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

});
