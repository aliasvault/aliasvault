import { describe, expect, it } from 'vitest';

import type { WebAuthnGetEventDetail } from '@/utils/passkey/webauthn.types';
import {
  cloneWebAuthnEventDetail,
  isRpIdAllowedForHost,
  validateWebAuthnEventDetail,
  validateWebAuthnRequest
} from '@/utils/passkey/WebAuthnRequestValidation';

describe('WebAuthnInterceptor request validation', () => {
  it('allows exact RP ID matches', () => {
    expect(isRpIdAllowedForHost('example.com', 'example.com')).toBe(true);
  });

  it('allows parent-domain RP IDs', () => {
    expect(isRpIdAllowedForHost('example.com', 'login.example.com')).toBe(true);
  });

  it('rejects sibling or unrelated RP IDs', () => {
    expect(isRpIdAllowedForHost('accounts.example.com', 'evil.example.com')).toBe(false);
    expect(isRpIdAllowedForHost('example.com', 'evil.com')).toBe(false);
  });

  it('rejects a forged origin in create requests', () => {
    expect(validateWebAuthnEventDetail('create', {
      requestId: 'request-1',
      origin: 'https://accounts.example.com',
      publicKey: {
        rp: {
          id: 'accounts.example.com',
          name: 'Example',
        },
        user: {
          id: 'dXNlcg',
          name: 'user@example.com',
          displayName: 'User',
        },
        challenge: 'Y2hhbGxlbmdl',
      },
    }, 'https://evil.example', 'evil.example')).toBe(false);
  });

  it('rejects a forged RP ID in get requests even when origin is honest', () => {
    expect(validateWebAuthnEventDetail('get', {
      requestId: 'request-1',
      origin: 'https://evil.example',
      publicKey: {
        challenge: 'Y2hhbGxlbmdl',
        rpId: 'accounts.example.com',
      },
    }, 'https://evil.example', 'evil.example')).toBe(false);
  });

  it('allows get requests without explicit RP ID for the current origin', () => {
    expect(validateWebAuthnEventDetail('get', {
      requestId: 'request-1',
      origin: 'https://login.example.com',
      publicKey: {
        challenge: 'Y2hhbGxlbmdl',
      },
    }, 'https://login.example.com', 'login.example.com')).toBe(true);
  });

  it('clones page event details before validation and forwarding', () => {
    const rawDetail = {
      requestId: 'request-1',
      origin: 'https://login.example.com',
      publicKey: {
        challenge: 'Y2hhbGxlbmdl',
      },
    };

    const clonedDetail = cloneWebAuthnEventDetail<WebAuthnGetEventDetail>(rawDetail);
    rawDetail.origin = 'https://attacker.example.com';
    rawDetail.publicKey = {
      challenge: 'bXV0YXRlZA',
      rpId: 'attacker.example.com',
    } as typeof rawDetail.publicKey;

    expect(clonedDetail).toEqual({
      requestId: 'request-1',
      origin: 'https://login.example.com',
      publicKey: {
        challenge: 'Y2hhbGxlbmdl',
      },
    });
    expect(validateWebAuthnEventDetail(
      'get',
      clonedDetail,
      'https://login.example.com',
      'login.example.com',
    )).toBe(true);
  });

  it('rejects malformed request fields after cloning', () => {
    expect(validateWebAuthnEventDetail('get', {
      requestId: 'request-1',
      origin: 'https://login.example.com',
      publicKey: {
        challenge: 123,
      },
    } as unknown as WebAuthnGetEventDetail, 'https://login.example.com', 'login.example.com')).toBe(false);
  });

  it('rejects a background request when sender origin and payload origin differ', () => {
    expect(validateWebAuthnRequest('get', {
      origin: 'https://victim.example.com',
      publicKey: {
        challenge: 'Y2hhbGxlbmdl',
        rpId: 'victim.example.com',
      },
    }, 'https://attacker.example.com', 'attacker.example.com')).toBe(false);
  });
});
