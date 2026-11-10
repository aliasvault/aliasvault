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
 * Routes of the windows the background opens for one request which handle a locked vault themselves.
 */
export const DEDICATED_WINDOW_PATHS: readonly string[] = [
  '/passkeys/create',
  '/passkeys/authenticate',
  '/autofill/confirm',
];
