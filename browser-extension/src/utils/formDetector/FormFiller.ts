import { Credential } from "../types/Credential";
import { FormFields } from "./types/FormFields";
import { CombinedDateOptionPatterns, CombinedGenderOptionPatterns } from "./FieldPatterns";
import { Gender } from "../generators/Identity/types/Gender";
/**
 * Class to fill the fields of a form with the given credential.
 */
export class FormFiller {
  /**
   * Constructor.
   */
  public constructor(
    private readonly form: FormFields,
    private readonly triggerInputEvents: (element: HTMLInputElement | HTMLSelectElement) => void
  ) {}

  /**
   * Fill the fields of the form with the given credential.
   * @param credential The credential to fill the form with.
   */
  public fillFields(credential: Credential): void {
    this.fillBasicFields(credential);
    this.fillBirthdateFields(credential);
    this.fillGenderFields(credential);
  }

  /**
   * Fill the basic fields of the form.
   * @param credential The credential to fill the form with.
   */
  private fillBasicFields(credential: Credential): void {
    if (this.form.usernameField) {
      this.form.usernameField.value = credential.Username;
      this.triggerInputEvents(this.form.usernameField);
    }

    if (this.form.passwordField) {
      this.fillPasswordField(this.form.passwordField, credential.Password);
      this.triggerInputEvents(this.form.passwordField);
    }

    if (this.form.passwordConfirmField) {
      this.fillPasswordField(this.form.passwordConfirmField, credential.Password);
      this.triggerInputEvents(this.form.passwordConfirmField);
    }

    if (this.form.emailField) {
      this.form.emailField.value = credential.Email;
      this.triggerInputEvents(this.form.emailField);
    }

    if (this.form.emailConfirmField) {
      this.form.emailConfirmField.value = credential.Email;
      this.triggerInputEvents(this.form.emailConfirmField);
    }

    if (this.form.fullNameField) {
      this.form.fullNameField.value = `${credential.Alias.FirstName} ${credential.Alias.LastName}`;
      this.triggerInputEvents(this.form.fullNameField);
    }

    if (this.form.firstNameField) {
      this.form.firstNameField.value = credential.Alias.FirstName;
      this.triggerInputEvents(this.form.firstNameField);
    }

    if (this.form.lastNameField) {
      this.form.lastNameField.value = credential.Alias.LastName;
      this.triggerInputEvents(this.form.lastNameField);
    }
  }

  /**
   * Fill the password field with the given password. This uses a small delay between each character to simulate human typing.
   * In the past there have been issues where Microsoft 365 login forms would clear the password field when just setting the value directly.
   *
   * @param field The password field to fill.
   * @param password The password to fill the field with.
   */
  private async fillPasswordField(field: HTMLInputElement, password: string): Promise<void> {
    // Clear the field first
    field.value = '';
    this.triggerInputEvents(field);

    // Type each character with a small delay
    for (let i = 0; i < password.length; i++) {
      field.value = password.substring(0, i + 1);
      // Small random delay between 5-15ms to simulate human typing
      await new Promise(resolve => setTimeout(resolve, Math.random() * 10 + 5));
    }
  }

  /**
   * Fill the birthdate fields of the form.
   * @param credential The credential to fill the form with.
   */
  private fillBirthdateFields(credential: Credential): void {
    if (!credential.Alias.BirthDate) {
      return;
    }

    const birthDate = new Date(credential.Alias.BirthDate);

    if (this.form.birthdateField.single) {
      this.fillSingleBirthdateField(birthDate);
    } else {
      this.fillSeparateBirthdateFields(birthDate);
    }
  }

  /**
   * Fill the single birthdate field.
   * @param birthDate The birthdate to fill the form with.
   */
  private fillSingleBirthdateField(birthDate: Date): void {
    const day = birthDate.getDate().toString().padStart(2, '0');
    const month = (birthDate.getMonth() + 1).toString().padStart(2, '0');
    const year = birthDate.getFullYear().toString();

    const formattedDate = this.formatDateString(day, month, year);
    this.form.birthdateField.single!.value = formattedDate;
    this.triggerInputEvents(this.form.birthdateField.single!);
  }

  /**
   * Format the date string based on the format of the birthdate field.
   * @param day The day of the birthdate.
   * @param month The month of the birthdate.
   * @param year The year of the birthdate.
   * @returns The formatted date string.
   */
  private formatDateString(day: string, month: string, year: string): string {
    switch (this.form.birthdateField.format) {
      case 'dd/mm/yyyy': return `${day}/${month}/${year}`;
      case 'mm/dd/yyyy': return `${month}/${day}/${year}`;
      case 'dd-mm-yyyy': return `${day}-${month}-${year}`;
      case 'mm-dd-yyyy': return `${month}-${day}-${year}`;
      case 'yyyy-mm-dd':
      default: return `${year}-${month}-${day}`;
    }
  }

  /**
   * Fill the separate birthdate fields.
   * @param birthDate The birthdate to fill the form with.
   */
  private fillSeparateBirthdateFields(birthDate: Date): void {
    this.fillDayField(birthDate);
    this.fillMonthField(birthDate);
    this.fillYearField(birthDate);
  }

  /**
   * Fill the day field.
   * @param birthDate The birthdate to fill the form with.
   */
  private fillDayField(birthDate: Date): void {
    if (!this.form.birthdateField.day) {
      return;
    }

    const dayElement = this.form.birthdateField.day as HTMLSelectElement | HTMLInputElement;
    const dayValue = birthDate.getDate().toString().padStart(2, '0');

    if ('options' in dayElement && dayElement.options) {
      const dayOption = Array.from(dayElement.options).find(opt =>
        opt.value === dayValue ||
        opt.value === birthDate.getDate().toString() ||
        opt.text === dayValue ||
        opt.text === birthDate.getDate().toString()
      );
      if (dayOption) {
        dayElement.value = dayOption.value;
      }
    } else {
      dayElement.value = dayValue;
    }
    this.triggerInputEvents(dayElement);
  }

  /**
   * Fill the month field.
   * @param birthDate The birthdate to fill the form with.
   */
  private fillMonthField(birthDate: Date): void {
    if (!this.form.birthdateField.month) {
      return;
    }

    const monthElement = this.form.birthdateField.month as HTMLSelectElement | HTMLInputElement;
    const monthValue = (birthDate.getMonth() + 1).toString().padStart(2, '0');

    if ('options' in monthElement && monthElement.options) {
      CombinedDateOptionPatterns.months.forEach(monthNames => {
        const monthOption = Array.from(monthElement.options).find(opt =>
          opt.value === monthValue ||
          opt.value === (birthDate.getMonth() + 1).toString() ||
          opt.text === monthValue ||
          opt.text === (birthDate.getMonth() + 1).toString() ||
          opt.text.toLowerCase() === monthNames[birthDate.getMonth()].toLowerCase() ||
          opt.text.toLowerCase() === monthNames[birthDate.getMonth()].substring(0, 3).toLowerCase()
        );
        if (monthOption) {
          monthElement.value = monthOption.value;
        }
      });
    } else {
      monthElement.value = monthValue;
    }
    this.triggerInputEvents(monthElement);
  }

  /**
   * Fill the year field.
   * @param birthDate The birthdate to fill the form with.
   */
  private fillYearField(birthDate: Date): void {
    if (!this.form.birthdateField.year) {
      return;
    }

    const yearElement = this.form.birthdateField.year as HTMLSelectElement | HTMLInputElement;
    const yearValue = birthDate.getFullYear().toString();

    if ('options' in yearElement && yearElement.options) {
      const yearOption = Array.from(yearElement.options).find(opt =>
        opt.value === yearValue ||
        opt.text === yearValue
      );
      if (yearOption) {
        yearElement.value = yearOption.value;
      }
    } else {
      yearElement.value = yearValue;
    }
    this.triggerInputEvents(yearElement);
  }

  /**
   * Fill the gender fields of the form.
   * @param credential The credential to fill the form with.
   */
  private fillGenderFields(credential: Credential): void {
    switch (this.form.genderField.type) {
      case 'select':
        this.fillGenderSelect(credential.Alias.Gender);
        break;
      case 'radio':
        this.fillGenderRadio(credential.Alias.Gender);
        break;
      case 'text':
        this.fillGenderText(credential.Alias.Gender);
        break;
    }
  }

  /**
   * Fill the gender select field.
   * @param gender The gender to fill the form with.
   */
  private fillGenderSelect(gender: Gender | undefined): void {
    if (!this.form.genderField.field || !gender) {
      return;
    }

    const selectElement = this.form.genderField.field as HTMLSelectElement;
    const options = Array.from(selectElement.options);
    const genderValues = gender === Gender.Male
      ? CombinedGenderOptionPatterns.male
      : CombinedGenderOptionPatterns.female;

    const genderOption = options.find(opt =>
      genderValues.includes(opt.value.toLowerCase()) ||
      genderValues.includes(opt.text.toLowerCase())
    );

    if (genderOption) {
      selectElement.value = genderOption.value;
      this.triggerInputEvents(selectElement);
    }
  }

  /**
   * Fill the gender radio fields.
   * @param gender The gender to fill the form with.
   */
  private fillGenderRadio(gender: Gender | undefined): void {
    const radioButtons = this.form.genderField.radioButtons;
    if (!radioButtons || !gender) {
      return;
    }

    let selectedRadio: HTMLInputElement | null = null;

    if (gender === Gender.Male && radioButtons.male) {
      radioButtons.male.checked = true;
      selectedRadio = radioButtons.male;
    } else if (gender === Gender.Female && radioButtons.female) {
      radioButtons.female.checked = true;
      selectedRadio = radioButtons.female;
    } else if (gender === Gender.Other && radioButtons.other) {
      radioButtons.other.checked = true;
      selectedRadio = radioButtons.other;
    }

    if (selectedRadio) {
      this.triggerInputEvents(selectedRadio);
    }
  }

  /**
   * Fill the gender text field.
   * @param gender The gender to fill the form with.
   */
  private fillGenderText(gender: Gender | undefined): void {
    if (!this.form.genderField.field || !gender) {
      return;
    }

    const inputElement = this.form.genderField.field as HTMLInputElement;
    inputElement.value = gender;
    this.triggerInputEvents(inputElement);
  }
}
