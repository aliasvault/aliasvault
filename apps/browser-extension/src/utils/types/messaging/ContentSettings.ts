import type { AutofillMatchingMode } from '@aliasvault/client/rust/RustCore';

/**
 * The local preferences a content script needs, resolved by the background for the sending frame's host.
 */
export type ContentSettings = {
  credentialPopupEnabled: boolean;
  totpPopupEnabled: boolean;
  autoCopyTotpOnAutofill: boolean;
  matchingMode: AutofillMatchingMode;
  vaultLockedDismissUntil: number;
  siteAutofillAllowed: boolean;
};
