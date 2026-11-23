/**
 * WebAuthn page script for Firefox and Safari, injected by the content script as the web-accessible "webauthn.js".
 */

import { installWebAuthnOverride } from '@/utils/passkey/WebAuthnPageOverride';

import { defineUnlistedScript } from '#imports';

export default defineUnlistedScript({
  exclude: ['chrome', 'edge'],
  main: installWebAuthnOverride,
});
