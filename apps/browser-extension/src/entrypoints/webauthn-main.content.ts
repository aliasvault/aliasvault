/**
 * WebAuthn page script for Chrome and Edge, run as a MAIN-world content script.
 * Loading it through a page script tag interferes with Connection-Allowlist in Chromium.
 * Firefox and Safari keep that script tag (webauthn.ts), as Connection-Allowlist is Chromium-only.
 */

import { installWebAuthnOverride } from '@/utils/passkey/WebAuthnPageOverride';

import { defineContentScript } from '#imports';

export default defineContentScript({
  include: ['chrome', 'edge'],
  matches: ['<all_urls>'],
  world: 'MAIN',
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_start',
  main: installWebAuthnOverride,
});
