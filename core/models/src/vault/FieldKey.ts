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

  /**
   * Notes content field
   * Type: TextArea
   */
  NotesContent: 'notes.content',
} as const;

/**
 * Type representing all valid field key values
 */
export type FieldKeyValue = typeof FieldKey[keyof typeof FieldKey];
