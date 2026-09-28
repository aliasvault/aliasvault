/**
 * Credit card information in the intermediary import format.
 */
export type ImportedCreditcard = {
  CardholderName?: string | null;
  Number?: string | null;
  ExpiryMonth?: string | null;
  ExpiryYear?: string | null;
  Cvv?: string | null;
  Pin?: string | null;
};
