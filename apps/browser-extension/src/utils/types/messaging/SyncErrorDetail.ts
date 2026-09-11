/**
 * What a failed sync reports, in the form the popup translates for display.
 */
export type SyncErrorDetail = {
  /** Translation key under `common.errors` naming the failure reason. */
  errorKey?: string;
  /** Client error code (`E-xxx`) whose translation is shown, tagged with the code. */
  errorCode?: string;
  /** Message shown as-is when neither a key nor a code applies. */
  error?: string;
};
