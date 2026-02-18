/**
 * Login detection module.
 * Detects login form submissions and offers to save credentials to the vault.
 */

export { LoginDetector } from './LoginDetector';
export type {
  CapturedLogin,
  LoginSubmissionEvent,
  SavePromptConfig,
  SavePromptOptions,
  AddUrlPromptOptions,
  SitePreference,
  LoginSaveSettings,
  LoginCaptureCallback,
  SavePromptPersistedState,
  LastAutofilledCredential,
} from './types';
