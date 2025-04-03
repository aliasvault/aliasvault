import { describe, it, expect } from 'vitest';
import { FormField, testField, testBirthdateFormat } from './TestUtils';

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
});
