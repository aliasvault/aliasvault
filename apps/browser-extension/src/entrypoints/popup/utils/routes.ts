/**
 * Routes representing the pre-vault auth flow (entry, init, login, unlock).
 * Treated specially by routing logic.
 */
export const AUTH_FLOW_PATHS: readonly string[] = [
  '/',
  '/reinitialize',
  '/login',
  '/unlock',
  '/unlock-success',
];
