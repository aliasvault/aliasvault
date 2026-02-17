/**
 * Types for login detection and credential saving functionality.
 */

/**
 * Represents login credentials captured from a form submission.
 */
export type CapturedLogin = {
  /** The username or email used for login */
  username: string;
  /** The password submitted */
  password: string;
  /** The full URL where the login was captured */
  url: string;
  /** The domain extracted from the URL */
  domain: string;
  /** Timestamp when the login was captured */
  timestamp: number;
  /** Suggested service name based on page title/URL */
  suggestedName: string;
  /** URL of the favicon/logo if found */
  faviconUrl?: string;
};

/**
 * Details about a form submission event.
 */
export type LoginSubmissionEvent = {
  /** The form element that was submitted */
  form: HTMLFormElement | null;
  /** The detected fields in the form */
  fields: {
    username: HTMLInputElement | null;
    password: HTMLInputElement | null;
  };
  /** How the submission was detected */
  method: 'form-submit' | 'ajax' | 'fetch' | 'navigation';
};

/**
 * Configuration for the save prompt display.
 */
export type SavePromptConfig = {
  /** Suggested name for the credential */
  suggestedName: string;
  /** The captured login data */
  login: CapturedLogin;
  /** Whether this appears to be a duplicate */
  isDuplicate: boolean;
  /** If duplicate, the ID of the matching item */
  matchingItemId?: string;
};

/**
 * Options for showing the save prompt.
 */
export type SavePromptOptions = {
  /** The captured login credentials */
  login: CapturedLogin;
  /** Callback when user clicks "Save" */
  onSave: (login: CapturedLogin, serviceName: string) => void;
  /** Callback when user clicks "Never for this site" */
  onNeverSave: (domain: string) => void;
  /** Callback when prompt is dismissed */
  onDismiss: () => void;
  /** Auto-dismiss timeout in milliseconds (default: 15000) */
  autoDismissMs?: number;
};

/**
 * Site preferences for login saving.
 */
export type SitePreference = {
  /** Never show save prompt for this site */
  neverSave: boolean;
  /** When this preference was set */
  timestamp: number;
};

/**
 * User settings for login save feature.
 */
export type LoginSaveSettings = {
  /** Whether the save login feature is enabled */
  enabled: boolean;
  /** Seconds before auto-dismiss (5-60) */
  autoDismissSeconds: number;
  /** Only capture on HTTPS sites */
  httpsOnly: boolean;
};

/**
 * Callback type for login capture events.
 */
export type LoginCaptureCallback = (login: CapturedLogin) => void;

/**
 * Persisted state for save prompt across page navigations.
 * Used to restore the prompt on traditional form submissions with redirects.
 */
export type SavePromptPersistedState = {
  /** The captured login credentials */
  login: CapturedLogin;
  /** Remaining time in milliseconds when the page navigated */
  remainingTimeMs: number;
  /** Initial auto-dismiss duration (for resetting if needed) */
  initialAutoDismissMs: number;
  /** Timestamp when this state was saved */
  savedAt: number;
  /** The domain where the prompt was shown (to validate on restore) */
  domain: string;
};
