/**
 * Field selectors for E2E tests.
 *
 * This module provides CSS selectors for form elements based on the FieldKey
 * constants from shared/models. This ensures tests use the same field identifiers
 * as the application.
 *
 * The field key values match those defined in shared/models/src/vault/FieldKey.ts
 * and are used as element IDs in ItemAddEdit.tsx
 */

/**
 * Field key constants matching shared/models/src/vault/FieldKey.ts and SystemFieldRegistry.ts
 * These are the raw field key values used in the application.
 */
export const FieldKey = {
  LoginUsername: 'login.username',
  LoginPassword: 'login.password',
  LoginUrl: 'login.url',
  NotesContent: 'notes.content',
  CardNumber: 'card.number',
  CardCardholderName: 'card.cardholder_name',
  CardExpiryMonth: 'card.expiry_month',
  CardExpiryYear: 'card.expiry_year',
  CardCvv: 'card.cvv',
  CardPin: 'card.pin',
  LoginEmail: 'login.email',
  IdentityFirstName: 'identity.first_name',
  IdentityLastName: 'identity.last_name',
  IdentityEmail: 'identity.email',
  AliasFirstName: 'alias.first_name',
  AliasLastName: 'alias.last_name',
} as const;

/**
 * Escape dots in field keys for use in CSS selectors.
 * CSS attribute selectors need dots escaped with backslash.
 */
function escapeFieldKey(fieldKey: string): string {
  return fieldKey.replace(/\./g, '\\.');
}

/**
 * CSS selectors for form input fields.
 * These match the id attributes used in ItemAddEdit.tsx
 */
export const FieldSelectors = {
  // Item name input (fixed ID, not from FieldKey)
  ITEM_NAME: 'input#itemName',

  // Login fields
  LOGIN_USERNAME: `input#${escapeFieldKey(FieldKey.LoginUsername)}`,
  LOGIN_PASSWORD: `input#${escapeFieldKey(FieldKey.LoginPassword)}`,
  LOGIN_URL: `input#${escapeFieldKey(FieldKey.LoginUrl)}-0`, // Multi-value field uses -0 suffix for first entry

  // Notes field (shared across item types)
  LOGIN_NOTES: `textarea#${escapeFieldKey(FieldKey.NotesContent)}`,

  // Card fields
  CARD_NUMBER: `input#${escapeFieldKey(FieldKey.CardNumber)}`,
  CARD_CARDHOLDER_NAME: `input#${escapeFieldKey(FieldKey.CardCardholderName)}`,
  CARD_EXPIRY_MONTH: `input#${escapeFieldKey(FieldKey.CardExpiryMonth)}`,
  CARD_EXPIRY_YEAR: `input#${escapeFieldKey(FieldKey.CardExpiryYear)}`,
  CARD_CVV: `input#${escapeFieldKey(FieldKey.CardCvv)}`,
  CARD_PIN: `input#${escapeFieldKey(FieldKey.CardPin)}`,

  // Identity fields
  IDENTITY_FIRST_NAME: `input#${escapeFieldKey(FieldKey.IdentityFirstName)}`,
  IDENTITY_LAST_NAME: `input#${escapeFieldKey(FieldKey.IdentityLastName)}`,
  IDENTITY_EMAIL: `input#${escapeFieldKey(FieldKey.IdentityEmail)}`,

  // Login email (used for both Login and Alias types)
  LOGIN_EMAIL: `input#${escapeFieldKey(FieldKey.LoginEmail)}`,

  // Alias fields
  ALIAS_FIRST_NAME: `input#${escapeFieldKey(FieldKey.AliasFirstName)}`,
  ALIAS_LAST_NAME: `input#${escapeFieldKey(FieldKey.AliasLastName)}`,
} as const;

/**
 * Common button selectors used across tests.
 */
export const ButtonSelectors = {
  ADD_NEW_ITEM: 'button[title="Add new item"]',
  EDIT_ITEM: 'button[title="Edit Item"]',
  SAVE: 'button#save-credential',
  ADD_FIELD_MENU: 'button#add-field-menu',
} as const;
