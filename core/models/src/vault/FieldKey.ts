/**
 * System field keys for the field-based data model.
 * These keys map to FieldDefinition.FieldKey values.
 *
 * System fields use predefined string keys for consistent reference
 * across all platforms. Custom (user-defined) fields have FieldKey = NULL
 * and are identified by their GUID and user-provided Label.
 *
 * Usage:
 * ```typescript
 * // Query by field key
 * WHERE FieldKey = FieldKey.LoginUsername
 *
 * // Insert system field
 * FieldKey = FieldKey.LoginPassword
 *
 * // Custom field
 * FieldKey = null  // User-defined field
 * ```
 */
export const FieldKey = {
  /**
   * Login username field
   * Type: Text
   */
  LoginUsername: 'login.username',

  /**
   * Login password field
   * Type: Password
   */
  LoginPassword: 'login.password',

  /**
   * Login notes field
   * Type: Text
   */
  LoginNotes: 'login.notes',

  /**
   * Login email field
   * Type: Email
   */
  LoginEmail: 'login.email',

  /**
   * Login URL field (multi-value)
   * Type: URL
   */
  LoginUrl: 'login.url',

  /**
   * Login recovery codes field (multi-value)
   * Type: Text
   */
  LoginRecoveryCodes: 'login.recovery_codes',

  /**
   * Credit card number field
   * Type: Text
   */
  CardNumber: 'card.number',

  /**
   * Credit card cardholder name field
   * Type: Text
   */
  CardCardholderName: 'card.cardholder_name',

  /**
   * Credit card expiry month field
   * Type: Text
   */
  CardExpiryMonth: 'card.expiry_month',

  /**
   * Credit card expiry year field
   * Type: Text
   */
  CardExpiryYear: 'card.expiry_year',

  /**
   * Credit card CVV field
   * Type: Password
   */
  CardCvv: 'card.cvv',

  /**
   * Credit card PIN field
   * Type: Password
   */
  CardPin: 'card.pin',

  /**
   * Identity title field (e.g., Mr., Mrs., Dr.)
   * Type: Text
   */
  IdentityTitle: 'identity.title',

  /**
   * Identity first name field
   * Type: Text
   */
  IdentityFirstName: 'identity.first_name',

  /**
   * Identity middle name field
   * Type: Text
   */
  IdentityMiddleName: 'identity.middle_name',

  /**
   * Identity last name field
   * Type: Text
   */
  IdentityLastName: 'identity.last_name',

  /**
   * Identity email field
   * Type: Email
   */
  IdentityEmail: 'identity.email',

  /**
   * Identity phone number field (multi-value)
   * Type: Text
   */
  IdentityPhoneNumbers: 'identity.phone_numbers',

  /**
   * Identity address line 1 field
   * Type: Text
   */
  IdentityAddressLine1: 'identity.address_line1',

  /**
   * Identity address line 2 field
   * Type: Text
   */
  IdentityAddressLine2: 'identity.address_line2',

  /**
   * Identity city field
   * Type: Text
   */
  IdentityCity: 'identity.city',

  /**
   * Identity state/province field
   * Type: Text
   */
  IdentityState: 'identity.state',

  /**
   * Identity postal code field
   * Type: Text
   */
  IdentityPostalCode: 'identity.postal_code',

  /**
   * Identity country field
   * Type: Text
   */
  IdentityCountry: 'identity.country',

  /**
   * Alias first name field
   * Type: Text
   */
  AliasFirstName: 'alias.first_name',

  /**
   * Alias last name field
   * Type: Text
   */
  AliasLastName: 'alias.last_name',

  /**
   * Alias gender field
   * Type: Text
   */
  AliasGender: 'alias.gender',

  /**
   * Alias birth date field
   * Type: Date
   */
  AliasBirthdate: 'alias.birthdate',
} as const;

/**
 * Type representing all valid field key values
 */
export type FieldKeyValue = typeof FieldKey[keyof typeof FieldKey];
