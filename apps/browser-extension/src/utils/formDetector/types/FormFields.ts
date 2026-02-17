export type FormFields = {
    form: HTMLFormElement | null;
    emailField: HTMLInputElement | null;
    emailConfirmField: HTMLInputElement | null;
    usernameField: HTMLInputElement | null;
    passwordField: HTMLInputElement | null;
    passwordConfirmField: HTMLInputElement | null;

    // Identity fields
    fullNameField: HTMLInputElement | null;
    firstNameField: HTMLInputElement | null;
    lastNameField: HTMLInputElement | null;

    // Birthdate fields can be either a single field or multiple fields
    birthdateField: {
      single: HTMLInputElement | null;
      format: string; // 'yyyy-mm-dd' | 'dd-mm-yyyy' | 'mm-dd-yyyy'
      day: HTMLInputElement | null;
      month: HTMLInputElement | null;
      year: HTMLInputElement | null;
    };

    // Gender field can be either select, radio or text input
    genderField: {
      type: 'select' | 'radio' | 'text';
      field: HTMLInputElement | HTMLSelectElement | null;
      radioButtons?: {
        male: HTMLInputElement | null;
        female: HTMLInputElement | null;
        other: HTMLInputElement | null;
      };
    };

    // TOTP/2FA field for one-time codes
    totpField: HTMLInputElement | null;
  }
