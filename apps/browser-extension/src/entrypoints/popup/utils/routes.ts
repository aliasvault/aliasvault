/**
 * Routes representing the pre-vault auth flow (entry, init, login, unlock).
 * Treated specially by routing logic.
 */
export const AUTH_FLOW_PATHS: readonly string[] = [
  '/',
  '/reinitialize',
  '/login',
  '/unlock',
];

/**
 * Routes of the dedicated passkey popup window, which handle a locked vault themselves.
 */
export const PASSKEY_POPUP_PATHS: readonly string[] = [
  '/passkeys/create',
  '/passkeys/authenticate',
];
