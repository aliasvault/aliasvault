import { describe, expect, it } from 'vitest';

import type { WebAuthnGetEventDetail } from '@/utils/passkey/webauthn.types';
import {
  cloneWebAuthnEventDetail,
  getWebAuthnRequestRpId,
  validateWebAuthnEventDetail,
  validateWebAuthnRequest
} from '@/utils/passkey/WebAuthnRequestValidation';

import { isSameOriginWithAncestors } from '../WebAuthnInterceptor';

type TestFrame = {
  location: {
    origin: string;
  };
  parent: TestFrame;
};

/**
 * Create a minimal same-window/cross-window parent chain for ancestor checks.
 */
const createFrameChain = (origins: string[]): Window => {
  const topFrame: TestFrame = {
    location: {
      origin: origins[origins.length - 1],
    },
    parent: undefined as unknown as TestFrame,
  };
  topFrame.parent = topFrame;

  let frame = topFrame;
  for (let index = origins.length - 2; index >= 0; index--) {
    frame = {
      location: {
        origin: origins[index],
      },
      parent: frame,
    };
  }

  return frame as unknown as Window;
};

/**
 * Create a frame whose parent behaves like a browser cross-origin ancestor.
 */
const createFrameWithInaccessibleParent = (): Window => {
  const inaccessibleParent: TestFrame = {
    /**
     * Simulate the DOMException thrown when reading a cross-origin location.
     */
    get location(): { origin: string } {
      throw new Error('Permission denied');
    },
    parent: undefined as unknown as TestFrame,
  };
  inaccessibleParent.parent = inaccessibleParent;

  return {
    location: {
      origin: 'https://login.example.com',
    },
    parent: inaccessibleParent,
  } as unknown as Window;
};

describe('WebAuthnInterceptor request validation', () => {
  it('allows WebAuthn interception in a top-level frame', () => {
    expect(isSameOriginWithAncestors(createFrameChain(['https://login.example.com']))).toBe(true);
  });

  it('allows WebAuthn interception in same-origin nested frames', () => {
    expect(isSameOriginWithAncestors(createFrameChain([
      'https://login.example.com',
      'https://login.example.com',
      'https://login.example.com',
    ]))).toBe(true);
  });

  it('rejects WebAuthn interception in cross-origin ancestor frames', () => {
    expect(isSameOriginWithAncestors(createFrameChain([
      'https://login.example.com',
      'https://attacker.example.com',
    ]))).toBe(false);
  });

  it('rejects WebAuthn interception when an ancestor origin cannot be read', () => {
    expect(isSameOriginWithAncestors(createFrameWithInaccessibleParent())).toBe(false);
  });

  it('reads the RP ID from create and get requests', () => {
    expect(getWebAuthnRequestRpId('create', { origin: 'https://a.example.com', publicKey: { rp: { id: 'example.com' } } })).toBe('example.com');
    expect(getWebAuthnRequestRpId('get', { origin: 'https://a.example.com', publicKey: { rpId: 'example.com' } })).toBe('example.com');
    expect(getWebAuthnRequestRpId('create', { origin: 'https://a.example.com', publicKey: {} })).toBeUndefined();
    expect(getWebAuthnRequestRpId('get', { origin: 'https://a.example.com' })).toBeUndefined();
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
    }, 'https://evil.example')).toBe(false);
  });

  it('leaves the RP ID decision to the background', () => {
    expect(validateWebAuthnEventDetail('get', {
      requestId: 'request-1',
      origin: 'https://twitter.com',
      publicKey: {
        challenge: 'Y2hhbGxlbmdl',
        rpId: 'x.com',
      },
    }, 'https://twitter.com')).toBe(true);
    expect(validateWebAuthnEventDetail('get', {
      requestId: 'request-1',
      origin: 'https://twitter.com',
      publicKey: {
        challenge: 'Y2hhbGxlbmdl',
        rpId: 42,
      },
    } as unknown as WebAuthnGetEventDetail, 'https://twitter.com')).toBe(false);
  });

  it('allows get requests without explicit RP ID for the current origin', () => {
    expect(validateWebAuthnEventDetail('get', {
      requestId: 'request-1',
      origin: 'https://login.example.com',
      publicKey: {
        challenge: 'Y2hhbGxlbmdl',
      },
    }, 'https://login.example.com')).toBe(true);
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
    )).toBe(true);
  });

  it('rejects malformed request fields after cloning', () => {
    expect(validateWebAuthnEventDetail('get', {
      requestId: 'request-1',
      origin: 'https://login.example.com',
      publicKey: {
        challenge: 123,
      },
    } as unknown as WebAuthnGetEventDetail, 'https://login.example.com')).toBe(false);
  });

  it('rejects a background request when sender origin and payload origin differ', () => {
    expect(validateWebAuthnRequest('get', {
      origin: 'https://victim.example.com',
      publicKey: {
        challenge: 'Y2hhbGxlbmdl',
        rpId: 'victim.example.com',
      },
    }, 'https://attacker.example.com')).toBe(false);
  });
});
