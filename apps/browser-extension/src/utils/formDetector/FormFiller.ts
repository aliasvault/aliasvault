import { Gender, IdentityHelperUtils } from "@/utils/dist/shared/identity-generator";
import type { Credential } from "@/utils/dist/shared/models/vault";
import { CombinedDateOptionPatterns, CombinedGenderOptionPatterns } from "@/utils/formDetector/FieldPatterns";
import { FormFields } from "@/utils/formDetector/types/FormFields";
import { ClickValidator } from "@/utils/security/ClickValidator";
/**
 * Class to fill the fields of a form with the given credential.
 */
export class FormFiller {
  private readonly clickValidator = ClickValidator.getInstance();

  /**
   * Constructor.
   */
  public constructor(
    private readonly form: FormFields,
    private readonly triggerInputEvents: (element: HTMLInputElement | HTMLSelectElement, animate?: boolean) => void
  ) {
    /**
     * Trigger input events.
     */
    this.triggerInputEvents = (element: HTMLInputElement | HTMLSelectElement, animate = true) : void => triggerInputEvents(element, animate);
  }

  /**
   * Fill the fields of the form with the given credential.
   * @param credential The credential to fill the form with.
   */
  public async fillFields(credential: Credential): Promise<void> {
    // Perform security validation before filling any fields
    if (!await this.validateFormSecurity()) {
      console.warn('[AliasVault Security] Autofill blocked due to security validation failure');
      return;
    }

    // Fill basic fields and password fields in parallel
    await Promise.all([
      this.fillBasicFields(credential),
      this.fillPasswordFields(credential)
    ]);

    this.fillBirthdateFields(credential);
    this.fillGenderFields(credential);
  }

  /**
   * Validate form security to prevent autofill in potential clickjacking scenarios.
   * This method checks for various attack vectors including:
   * - Page-wide opacity manipulation
   * - Form field obstruction via overlays
   * - Suspicious element positioning
   * - Multiple forms with identical fields (potential decoy attacks)
   */
  private async validateFormSecurity(): Promise<boolean> {
    try {
      // Skip security validation in test environments where browser APIs may not be available
      if (typeof window === 'undefined' || typeof MouseEvent === 'undefined') {
        return true;
      }

      // 1. Check page-wide security using ClickValidator (detects body/HTML opacity tricks)
      const dummyEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: window.innerWidth / 2,
        clientY: window.innerHeight / 2
      });
      // Note: isTrusted is read-only and set by the browser

      if (!await this.clickValidator.validateClick(dummyEvent)) {
        console.warn('[AliasVault Security] Form autofill blocked: Page-wide attack detected');
        return false;
      }

      // 2. Check form field obstruction and positioning
      const formFields = this.getAllFormFields();
      for (const field of formFields) {
        if (!this.validateFieldSecurity(field)) {
          console.warn('[AliasVault Security] Form autofill blocked: Field obstruction detected', field);
          return false;
        }
      }

      // 3. Check for suspicious form duplication (decoy attack)
      if (this.detectDecoyForms()) {
        console.warn('[AliasVault Security] Form autofill blocked: Multiple suspicious forms detected');
        return false;
      }

      return true;
    } catch (error) {
      console.error('[AliasVault Security] Form security validation error:', error);
      return false; // Fail safely - block autofill if validation fails
    }
  }

  /**
   * Get all form fields that will be filled.
   */
  private getAllFormFields(): HTMLElement[] {
    const fields: HTMLElement[] = [];

    if (this.form.usernameField) {
      fields.push(this.form.usernameField);
    }
    if (this.form.passwordField) {
      fields.push(this.form.passwordField);
    }
    if (this.form.passwordConfirmField) {
      fields.push(this.form.passwordConfirmField);
    }
    if (this.form.emailField) {
      fields.push(this.form.emailField);
    }
    if (this.form.emailConfirmField) {
      fields.push(this.form.emailConfirmField);
    }

    return fields;
  }

  /**
   * Validate individual field security to detect obstruction attacks.
   */
  private validateFieldSecurity(field: HTMLElement): boolean {
    if (!field) {
      return true;
    }

    // Skip field validation in test environments where browser APIs may not be available
    if (typeof window === 'undefined' || typeof document === 'undefined' || !document.elementsFromPoint) {
      return true;
    }

    const rect = field.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Check if field is within viewport
    if (rect.width === 0 || rect.height === 0 ||
        centerX < 0 || centerY < 0 ||
        centerX > window.innerWidth || centerY > window.innerHeight) {
      console.warn('[AliasVault Security] Field outside viewport or zero-sized:', rect);
      return false;
    }

    // Use elementsFromPoint to check what's actually at the field center
    try {
      const elementsAtPoint = document.elementsFromPoint(centerX, centerY);

      if (elementsAtPoint.length === 0) {
        console.warn('[AliasVault Security] No elements found at field center');
        return false;
      }

      // Check if our field is in the element stack (or its parents/children)
      const fieldFound = elementsAtPoint.some(element =>
        element === field ||
        field.contains(element) ||
        element.contains(field)
      );

      if (!fieldFound) {
        console.warn('[AliasVault Security] Field is obstructed by other elements');
        return false;
      }

      // Check for suspicious covering elements
      const suspiciousCovering = elementsAtPoint.slice(0, 3).some(element => {
        if (element === field || field.contains(element) || element.contains(field)) {
          return false; // This is our field or related element
        }

        const style = getComputedStyle(element);

        // Check for nearly transparent overlays
        const opacity = parseFloat(style.opacity);
        if (opacity > 0 && opacity < 0.1) {
          console.warn('[AliasVault Security] Nearly transparent overlay detected:', element);
          return true;
        }

        // Check for high z-index elements (potential overlays)
        const zIndex = parseInt(style.zIndex) || 0;
        if (zIndex > 1000000) {
          console.warn('[AliasVault Security] Suspicious high z-index element:', element, zIndex);
          return true;
        }

        // Check for elements covering large areas (potential clickjacking overlays)
        const elementRect = element.getBoundingClientRect();
        if (elementRect.width >= window.innerWidth * 0.8 &&
            elementRect.height >= window.innerHeight * 0.8) {
          console.warn('[AliasVault Security] Large covering element detected:', element);
          return true;
        }

        return false;
      });

      return !suspiciousCovering;
    } catch (error) {
      console.warn('[AliasVault Security] Field validation error:', error);
      return false; // Fail safely
    }
  }

  /**
   * Detect potential decoy forms (multiple forms with similar fields).
   */
  private detectDecoyForms(): boolean {
    try {
      // Find all forms on the page
      const allForms = Array.from(document.querySelectorAll('form'));

      if (allForms.length <= 1) {
        return false; // Only one form, no decoy risk
      }

      let suspiciousFormCount = 0;

      for (const form of allForms) {
        const hasPasswordField = form.querySelector('input[type="password"]');
        const hasEmailField = form.querySelector('input[type="email"], input[name*="email" i], input[placeholder*="email" i]');
        const hasUsernameField = form.querySelector('input[type="text"], input[name*="user" i], input[placeholder*="user" i]');

        // Count forms with login-like patterns
        if (hasPasswordField && (hasEmailField || hasUsernameField)) {
          const formRect = form.getBoundingClientRect();
          const isVisible = formRect.width > 0 && formRect.height > 0;

          if (isVisible) {
            suspiciousFormCount++;
          }
        }
      }

      // If more than 2 visible login forms, it's suspicious
      if (suspiciousFormCount > 2) {
        console.warn('[AliasVault Security] Multiple login forms detected:', suspiciousFormCount);
        return true;
      }

      return false;
    } catch (error) {
      console.warn('[AliasVault Security] Decoy form detection error:', error);
      return false; // Don't block on detection errors
    }
  }

  /**
   * Set value on an input element, handling both regular inputs and custom elements with shadow DOM.
   * @param element The element to set the value on
   * @param value The value to set
   */
  private setElementValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
    // Try to set value directly on the element
    element.value = value;

    // If it's a custom element with shadow DOM, try to find and fill the actual input
    if (element.shadowRoot) {
      const shadowInput = element.shadowRoot.querySelector('input, textarea') as HTMLInputElement;
      if (shadowInput) {
        shadowInput.value = value;
        // Trigger events on the shadow input as well
        this.triggerInputEvents(shadowInput, false);
      }
    }

    // Also check if the element contains a regular child input (non-shadow DOM)
    const childInput = element.querySelector('input, textarea') as HTMLInputElement;
    if (childInput && childInput !== element) {
      childInput.value = value;
      this.triggerInputEvents(childInput, false);
    }
  }

  /**
   * Fill the basic fields of the form.
   * @param credential The credential to fill the form with.
   */
  private async fillBasicFields(credential: Credential): Promise<void> {
    if (this.form.usernameField && credential.Username) {
      await this.fillTextFieldWithTyping(this.form.usernameField, credential.Username);
    }

    if (this.form.emailField && (credential.Alias?.Email !== undefined || credential.Username !== undefined)) {
      if (credential.Alias?.Email) {
        this.setElementValue(this.form.emailField, credential.Alias.Email);
        this.triggerInputEvents(this.form.emailField);
      } else if (credential.Username && !this.form.usernameField) {
        /*
         * If current form has no username field AND the credential has a username
         * then we can assume the username should be used as the email.
         */

        /*
         * This applies to the usecase where the AliasVault credential was imported
         * from a previous password manager that only had username/password fields
         * or where the user manually created a credential with only a username/password.
         */
        this.setElementValue(this.form.emailField, credential.Username);
        this.triggerInputEvents(this.form.emailField);
      }
    }

    if (this.form.emailConfirmField && credential.Alias?.Email) {
      this.setElementValue(this.form.emailConfirmField, credential.Alias.Email);
      this.triggerInputEvents(this.form.emailConfirmField);
    }

    if (this.form.fullNameField && credential.Alias?.FirstName && credential.Alias?.LastName) {
      this.setElementValue(this.form.fullNameField, `${credential.Alias.FirstName} ${credential.Alias.LastName}`);
      this.triggerInputEvents(this.form.fullNameField);
    }

    if (this.form.firstNameField && credential.Alias?.FirstName) {
      this.setElementValue(this.form.firstNameField, credential.Alias.FirstName);
      this.triggerInputEvents(this.form.firstNameField);
    }

    if (this.form.lastNameField && credential.Alias?.LastName) {
      this.setElementValue(this.form.lastNameField, credential.Alias.LastName);
      this.triggerInputEvents(this.form.lastNameField);
    }
  }

  /**
   * Fill a text field with character-by-character typing to better simulate human input.
   * This method is similar to fillPasswordField but optimized for regular text fields.
   *
   * @param field The text field to fill.
   * @param text The text to fill the field with.
   */
  private async fillTextFieldWithTyping(field: HTMLInputElement, text: string): Promise<void> {
    // Find the actual input element (could be in shadow DOM)
    let actualInput = field;

    // Check for shadow DOM input
    if (field.shadowRoot) {
      const shadowInput = field.shadowRoot.querySelector('input, textarea') as HTMLInputElement;
      if (shadowInput) {
        actualInput = shadowInput;
      }
    } else if (field.tagName.toLowerCase() !== 'input' && field.tagName.toLowerCase() !== 'textarea') {
      // Check for child input (non-shadow DOM) only if field is not already an input
      const childInput = field.querySelector('input, textarea') as HTMLInputElement;
      if (childInput) {
        actualInput = childInput;
      }
    }

    // Clear the field first without triggering events
    actualInput.value = '';

    // Type each character with a small delay
    for (let i = 0; i < text.length; i++) {
      actualInput.value += text[i];

      /*
       * Small delay between characters to simulate human typing
       * This helps with sites that have input event handlers
       */
      await new Promise(resolve => setTimeout(resolve, Math.random() * 10 + 10));
    }

    // Trigger events once after all typing is complete
    this.triggerInputEvents(actualInput, true);
  }

  /**
   * Fill password fields sequentially to avoid visual conflicts.
   * First fills the main password field, then the confirm field if present.
   * @param credential The credential containing the password.
   */
  private async fillPasswordFields(credential: Credential): Promise<void> {
    if (!credential.Password) {
      return;
    }

    // Fill main password field first
    if (this.form.passwordField) {
      await this.fillPasswordField(this.form.passwordField, credential.Password);
    }

    // Then fill password confirm field after main field is complete
    if (this.form.passwordConfirmField) {
      await this.fillPasswordField(this.form.passwordConfirmField, credential.Password);
    }
  }

  /**
   * Fill the password field with the given password. This uses a small delay between each character to simulate human typing.
   * Simulates actual keystroke behavior by appending characters one by one.
   * Supports both regular inputs and custom elements with shadow DOM.
   *
   * @param field The password field to fill.
   * @param password The password to fill the field with.
   */
  private async fillPasswordField(field: HTMLInputElement, password: string): Promise<void> {
    // Find the actual input element (could be in shadow DOM)
    let actualInput = field;

    // Check for shadow DOM input
    if (field.shadowRoot) {
      const shadowInput = field.shadowRoot.querySelector('input[type="password"], input') as HTMLInputElement;
      if (shadowInput) {
        actualInput = shadowInput;
      }
    } else if (field.tagName.toLowerCase() !== 'input') {
      // Check for child input (non-shadow DOM) only if field is not already an input
      const childInput = field.querySelector('input[type="password"], input') as HTMLInputElement;
      if (childInput) {
        actualInput = childInput;
      }
    }

    // Clear the field first without triggering events
    actualInput.value = '';

    // Type each character with a small delay
    for (let i = 0; i < password.length; i++) {
      actualInput.value += password[i];

      /*
       * Small delay between characters to simulate human typing
       * This helps with sites that have input event handlers
       */
      await new Promise(resolve => setTimeout(resolve, Math.random() * 10 + 10));
    }

    // Trigger events once after all typing is complete
    this.triggerInputEvents(actualInput, true);
  }

  /**
   * Fill the birthdate fields of the form.
   * @param credential The credential to fill the form with.
   */
  private fillBirthdateFields(credential: Credential): void {
    // TODO: when birth date is made optional in datamodel, we can remove this mindate check here.
    if (!IdentityHelperUtils.isValidBirthDate(credential.Alias.BirthDate)) {
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
        this.fillGenderSelect(credential.Alias.Gender as Gender | undefined);
        break;
      case 'radio':
        this.fillGenderRadio(credential.Alias.Gender as Gender | undefined);
        break;
      case 'text':
        this.fillGenderText(credential.Alias.Gender as Gender | undefined);
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
