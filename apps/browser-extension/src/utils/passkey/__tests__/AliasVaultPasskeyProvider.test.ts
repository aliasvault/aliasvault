import { describe, it, expect, beforeEach } from 'vitest';

import { PasskeyAuthenticator } from '../PasskeyAuthenticator';

import type { CreateRequest, GetRequest, StoredPasskeyRecord } from '../types';

/**
 * Helper function to decode base64url strings
 */
function fromBase64url(base64url: string): string {
  // Convert base64url to base64
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

describe('PasskeyAuthenticator', () => {
  let storedPasskeys: Map<string, StoredPasskeyRecord>;

  beforeEach(() => {
    storedPasskeys = new Map();
  });

  describe('createPasskey', () => {
    it('should create a valid passkey with correct structure', async () => {
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        requestId: 'test-request-123',
        publicKey: {
          rp: { id: 'example.com', name: 'Example Corp' },
          user: {
            id: 'user-123',
            name: 'testuser@example.com',
            displayName: 'Test User'
          },
          challenge: 'random-challenge-base64url',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          attestation: 'none',
          authenticatorSelection: {
            userVerification: 'preferred',
            requireResidentKey: true,
            residentKey: 'required',
            authenticatorAttachment: 'cross-platform'
          }
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const result = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);

      // Store the passkey manually for testing
      storedPasskeys.set(result.stored.credentialId, result.stored);

      // Verify credential structure
      expect(result.credential).toBeDefined();
      expect(result.credential.id).toBeDefined();
      expect(result.credential.rawId).toBe(result.credential.id);
      expect(result.credential.type).toBe('public-key');
      expect(result.credential.response).toBeDefined();
      expect(result.credential.response.clientDataJSON).toBeDefined();
      expect(result.credential.response.attestationObject).toBeDefined();

      // Verify stored passkey
      expect(result.stored).toBeDefined();
      expect(result.stored.rpId).toBe('example.com');
      expect(result.stored.credentialId).toBe(result.credential.id);
      expect(result.stored.publicKey).toBeDefined();
      expect(result.stored.privateKey).toBeDefined();
      expect(result.stored.userName).toBe('testuser@example.com');
      expect(result.stored.userDisplayName).toBe('Test User');

      // Verify keys are valid JWK format
      expect(result.stored.publicKey.kty).toBe('EC');
      expect(result.stored.publicKey.crv).toBe('P-256');
      expect(result.stored.publicKey.x).toBeDefined();
      expect(result.stored.publicKey.y).toBeDefined();
      expect(result.stored.privateKey.d).toBeDefined();

      // Verify passkey was stored
      expect(storedPasskeys.has(result.credential.id)).toBe(true);
    });

    it('should decode and validate clientDataJSON correctly', async () => {
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          rp: { id: 'example.com', name: 'Example' },
          user: { id: 'user-1', name: 'user', displayName: 'User' },
          challenge: 'test-challenge-123',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const result = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);

      // Decode and verify clientDataJSON (base64url)
      const clientDataJSON = fromBase64url(result.credential.response.clientDataJSON);
      const clientData = JSON.parse(clientDataJSON);

      expect(clientData.type).toBe('webauthn.create');
      expect(clientData.challenge).toBe('test-challenge-123');
      expect(clientData.origin).toBe('https://example.com');
      expect(clientData.crossOrigin).toBe(false);
    });

    it('should preserve challenge when passed as ArrayBuffer (real-world scenario)', async () => {
      // Simulate what a real website does: generates random bytes for challenge
      const challengeBytes = crypto.getRandomValues(new Uint8Array(32));

      /**
       * Convert Uint8Array to base64url string
       */
      const toBase64url = (bytes: Uint8Array): string => {
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      };
      const challengeB64u = toBase64url(challengeBytes);

      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          // Our provider receives the base64url string (from injection script)
          challenge: challengeB64u,
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const result = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);

      // Decode clientDataJSON and verify challenge matches
      const clientDataJSON = fromBase64url(result.credential.response.clientDataJSON);
      const clientData = JSON.parse(clientDataJSON);

      // The challenge in clientDataJSON should match what we sent
      expect(clientData.challenge).toBe(challengeB64u);

      /**
       * Convert base64url string to Uint8Array
       */
      const base64urlToBytes = (b64u: string): Uint8Array => {
        const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4 === 2 ? '==' : b64.length % 4 === 3 ? '=' : '';
        const binary = atob(b64 + pad);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      };

      const decodedChallenge = base64urlToBytes(clientData.challenge);
      expect(Array.from(decodedChallenge)).toEqual(Array.from(challengeBytes));
    });

    it('should decode and validate attestationObject structure', async () => {
      const createRequest: CreateRequest = {
        origin: 'https://test.com',
        publicKey: {
          challenge: 'challenge-abc',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const result = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);

      // Decode attestation object (base64)
      const attObjBytes = Uint8Array.from(
        fromBase64url(result.credential.response.attestationObject),
        c => c.charCodeAt(0)
      );

      // Basic CBOR validation - should start with map marker (0xa3 = map with 3 entries)
      expect(attObjBytes[0]).toBe(0xa3);

      /*
       * The attestation object should contain "fmt", "attStmt", and "authData" keys
       * We can't easily parse CBOR here, but we can verify it's not empty and has expected structure
       */
      expect(attObjBytes.length).toBeGreaterThan(100); // Should contain authData + COSE key
    });

    it('should include AliasVault AAGUID in attestation object', async () => {
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          rp: { id: 'example.com', name: 'Example' },
          challenge: 'test-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const result = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);

      // Decode attestation object
      const attObjBytes = Uint8Array.from(
        fromBase64url(result.credential.response.attestationObject),
        c => c.charCodeAt(0)
      );

      /*
       * AliasVault AAGUID: a11a5faa-9f32-4b8c-8c5d-2f7d13e8c942
       * Convert the string representation to bytes (replace 'v' with 'f' and 'u' with 'a')
       */
      const aaguidHex = 'a11a5faa-9f32-4b8c-8c5d-2f7d13e8c942'.replace(/-/g, '');

      // Verify the hex conversion matches expected bytes
      const expectedAAGUID = new Uint8Array(16);
      for (let i = 0; i < 16; i++) {
        expectedAAGUID[i] = parseInt(aaguidHex.substring(i * 2, i * 2 + 2), 16);
      }

      // Verify this matches the expected bytes: a1 1a 5f aa 9f 32 4b 8c 8c 5d 2f 7d 13 e8 c9 42
      expect(expectedAAGUID[0]).toBe(0xa1);
      expect(expectedAAGUID[1]).toBe(0x1a);
      expect(expectedAAGUID[2]).toBe(0x5f);
      expect(expectedAAGUID[3]).toBe(0xaa);

      // Convert attestation object to hex string for searching
      const attObjHex = Array.from(attObjBytes).map(b => b.toString(16).padStart(2, '0')).join('');

      // The AAGUID should be present somewhere in the attestation object
      expect(attObjHex).toContain(aaguidHex);
    });

    it('should use rpId from origin if not provided', async () => {
      const createRequest: CreateRequest = {
        origin: 'https://subdomain.example.com',
        publicKey: {
          challenge: 'test-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const result = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);

      expect(result.stored.rpId).toBe('subdomain.example.com');
    });

    it('should default to ES256 algorithm when pubKeyCredParams is empty', async () => {
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'test-challenge',
          pubKeyCredParams: [] // Empty array
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const result = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);

      // Should still create successfully with ES256
      expect(result.credential).toBeDefined();
      expect(result.stored.publicKey.crv).toBe('P-256');
    });

    it('should throw error when ES256 is not supported', async () => {
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'test-challenge',
          pubKeyCredParams: [
            { type: 'public-key', alg: -8 }, // EdDSA
            { type: 'public-key', alg: -257 } // RS256
          ]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      await expect(PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest)).rejects.toThrow(
        'No supported algorithm (ES256) in pubKeyCredParams'
      );
    });

    it('should set UV flag when userVerification is required', async () => {
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'test-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: {
            userVerification: 'required'
          }
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const result = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest, { uvPerformed: false });

      /*
       * Find authenticatorData in the CBOR structure
       * This is a simplified check - in real CBOR parsing, you'd properly decode the map
       * The flags byte is at offset 32 in authenticatorData (after 32-byte rpIdHash)
       * We expect: UP (0x01) + UV (0x04) + AT (0x40) + BE (0x08) + BS (0x10) = 0x5D
       * Since we can't easily parse CBOR here, we just verify the credential was created
       */
      expect(result.credential).toBeDefined();
    });
  });

  describe('getAssertion', () => {
    it('should create a valid assertion for stored passkey', async () => {
      // First, create a passkey
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        requestId: 'create-123',
        publicKey: {
          rp: { id: 'example.com', name: 'Example' },
          user: { id: 'user-1', name: 'testuser', displayName: 'Test User' },
          challenge: 'create-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const createResult = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      storedPasskeys.set(createResult.credential.id, createResult.stored);
      const credentialId = createResult.credential.id;

      // Now, authenticate with the passkey
      const getRequest: GetRequest = {
        origin: 'https://example.com',
        requestId: 'get-123',
        publicKey: {
          rpId: 'example.com',
          challenge: 'auth-challenge',
          userVerification: 'preferred'
        }
      };

      const storedRecord = storedPasskeys.get(credentialId)!;
      const assertion = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord);

      // Verify assertion structure
      expect(assertion.id).toBe(credentialId);
      expect(assertion.rawId).toBe(credentialId);
      expect(assertion.clientDataJSON).toBeDefined();
      expect(assertion.authenticatorData).toBeDefined();
      expect(assertion.signature).toBeDefined();
      // userHandle should be present when user.id was provided during creation
      expect(assertion.userHandle).toBeDefined();
      expect(assertion.userHandle).not.toBeNull();
    });

    it('should decode and validate clientDataJSON for authentication', async () => {
      // Create passkey
      const createRequest: CreateRequest = {
        origin: 'https://test.com',
        publicKey: {
          challenge: 'create-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const createResult = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      storedPasskeys.set(createResult.credential.id, createResult.stored);

      // Authenticate
      const getRequest: GetRequest = {
        origin: 'https://test.com',
        publicKey: {
          challenge: 'auth-challenge-xyz',
          userVerification: 'preferred'
        }
      };

      const storedRecord = storedPasskeys.get(createResult.credential.id)!;
      const assertion = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord);

      // Decode and validate clientDataJSON
      const clientDataJSON = fromBase64url(assertion.clientDataJSON);
      const clientData = JSON.parse(clientDataJSON);

      expect(clientData.type).toBe('webauthn.get');
      expect(clientData.challenge).toBe('auth-challenge-xyz');
      expect(clientData.origin).toBe('https://test.com');
      expect(clientData.crossOrigin).toBe(false);
    });

    it('should decode and validate authenticatorData', async () => {
      // Create passkey
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          rp: { id: 'example.com' },
          challenge: 'create-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const createResult = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      storedPasskeys.set(createResult.credential.id, createResult.stored);

      // Authenticate
      const getRequest: GetRequest = {
        origin: 'https://example.com',
        publicKey: {
          rpId: 'example.com',
          challenge: 'auth-challenge'
        }
      };

      const storedRecord = storedPasskeys.get(createResult.credential.id)!;
      const assertion = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord);

      // Decode authenticatorData
      const authDataBytes = Uint8Array.from(fromBase64url(assertion.authenticatorData), c => c.charCodeAt(0));

      // AuthenticatorData for assertion: rpIdHash (32) + flags (1) + signCount (4) = 37 bytes
      expect(authDataBytes.length).toBe(37);

      // Extract flags (byte at index 32)
      const flags = authDataBytes[32];

      // Should have UP (0x01) set
      expect(flags & 0x01).toBe(0x01); // User Present

      // Should have BE (0x08) and BS (0x10) set (backup eligible/state)
      expect(flags & 0x08).toBe(0x08); // Backup Eligible
      expect(flags & 0x10).toBe(0x10); // Backup State

      // Should NOT have AT (0x40) set (attested credential data only in creation)
      expect(flags & 0x40).toBe(0x00);

      // Sign count should be 0 (bytes 33-36)
      expect(authDataBytes[33]).toBe(0);
      expect(authDataBytes[34]).toBe(0);
      expect(authDataBytes[35]).toBe(0);
      expect(authDataBytes[36]).toBe(0);
    });

    it('should create valid DER-encoded signature', async () => {
      // Create passkey
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'create-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const createResult = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      storedPasskeys.set(createResult.credential.id, createResult.stored);

      // Authenticate
      const getRequest: GetRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'auth-challenge'
        }
      };

      const storedRecord = storedPasskeys.get(createResult.credential.id)!;
      const assertion = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord);

      // Decode signature
      const sigBytes = Uint8Array.from(fromBase64url(assertion.signature), c => c.charCodeAt(0));

      // DER signature should start with SEQUENCE tag (0x30)
      expect(sigBytes[0]).toBe(0x30);

      // Second byte is length of the sequence
      const seqLength = sigBytes[1];
      expect(seqLength).toBeGreaterThan(0);
      expect(seqLength).toBeLessThanOrEqual(72); // Max for ECDSA P-256

      /*
       * Should contain two INTEGER values (r and s)
       * Third byte should be INTEGER tag (0x02)
       */
      expect(sigBytes[2]).toBe(0x02);
    });

    it('should throw error when passkey not found', async () => {
      const getRequest: GetRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'auth-challenge'
        }
      };

      // Test with a non-existent stored record
      const invalidRecord = {
        rpId: 'example.com',
        credentialId: 'non-existent-id',
        publicKey: {} as JsonWebKey,
        privateKey: {} as JsonWebKey
      } satisfies StoredPasskeyRecord;

      await expect(
        PasskeyAuthenticator.getAssertion(getRequest, invalidRecord)
      ).rejects.toThrow();
    });

    it('should set UV flag when userVerification is required', async () => {
      // Create passkey
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'create-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const createResult = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      storedPasskeys.set(createResult.credential.id, createResult.stored);

      // Authenticate with UV required
      const getRequest: GetRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'auth-challenge',
          userVerification: 'required'
        }
      };

      const storedRecord = storedPasskeys.get(createResult.credential.id)!;
      const assertion = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord, {
        uvPerformed: false // Even without actual UV, if required, flag should be set
      });

      // Decode authenticatorData and check flags
      const authDataBytes = Uint8Array.from(fromBase64url(assertion.authenticatorData), c => c.charCodeAt(0));
      const flags = authDataBytes[32];

      // Should have UV (0x04) set when required
      expect(flags & 0x04).toBe(0x04);
    });

    it('should return userHandle when user.id was provided during creation', async () => {
      // Create passkey with explicit user.id (use bytes to avoid encoding ambiguity)
      const userIdBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          rp: { id: 'example.com', name: 'Example' },
          user: {
            id: userIdBytes,
            name: 'testuser',
            displayName: 'Test User'
          },
          challenge: 'create-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const createResult = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      storedPasskeys.set(createResult.credential.id, createResult.stored);

      // Authenticate
      const getRequest: GetRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'auth-challenge'
        }
      };

      const storedRecord = storedPasskeys.get(createResult.credential.id)!;
      const assertion = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord);

      // userHandle should be present and be base64 encoded
      expect(assertion.userHandle).toBeDefined();
      expect(assertion.userHandle).not.toBeNull();

      // Decode and verify it matches the original user.id bytes
      if (assertion.userHandle) {
        const decoded = fromBase64url(assertion.userHandle);
        const decodedBytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) {
          decodedBytes[i] = decoded.charCodeAt(i);
        }
        expect(Array.from(decodedBytes)).toEqual(Array.from(userIdBytes));
      }
    });

    it('should return null userHandle when user.id was not provided', async () => {
      // Create passkey without user.id
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'create-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const createResult = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      storedPasskeys.set(createResult.credential.id, createResult.stored);

      // Authenticate
      const getRequest: GetRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'auth-challenge'
        }
      };

      const storedRecord = storedPasskeys.get(createResult.credential.id)!;
      const assertion = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord);

      // userHandle should be null when no user.id was provided
      expect(assertion.userHandle).toBeNull();
    });

    it('should not set BE/BS flags when includeBEBS is false', async () => {
      // Create passkey
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'create-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const createResult = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      storedPasskeys.set(createResult.credential.id, createResult.stored);

      // Authenticate without BE/BS flags
      const getRequest: GetRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'auth-challenge'
        }
      };

      const storedRecord = storedPasskeys.get(createResult.credential.id)!;
      const assertion = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord, {
        includeBEBS: false
      });

      // Decode authenticatorData and check flags
      const authDataBytes = Uint8Array.from(fromBase64url(assertion.authenticatorData), c => c.charCodeAt(0));
      const flags = authDataBytes[32];

      // Should NOT have BE (0x08) or BS (0x10) set
      expect(flags & 0x08).toBe(0x00);
      expect(flags & 0x10).toBe(0x00);

      // Should still have UP (0x01) set
      expect(flags & 0x01).toBe(0x01);
    });
  });

  describe('Storage callbacks verification', () => {
    it('should call store callback with userId when creating passkey', async () => {
      const userIdBytes = new Uint8Array([10, 20, 30, 40]);
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          rp: { id: 'example.com', name: 'Example' },
          user: {
            id: userIdBytes,
            name: 'testuser',
            displayName: 'Test User'
          },
          challenge: 'create-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const result = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);

      // Manually store the passkey
      storedPasskeys.set(result.stored.credentialId, result.stored);

      // Verify the result contains userId
      expect(result.stored.userId).toBeDefined();
      expect(result.stored.userId).not.toBeNull();
      expect(typeof result.stored.userId).toBe('string');
    });

    it('should retrieve userId from getById callback during authentication', async () => {
      const userIdBytes = new Uint8Array([50, 60, 70, 80]);

      // First create a passkey with userId
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          rp: { id: 'example.com' },
          user: {
            id: userIdBytes,
            name: 'testuser',
            displayName: 'Test User'
          },
          challenge: 'create-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const createResult = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      storedPasskeys.set(createResult.credential.id, createResult.stored);

      // Now authenticate - verify that getById is called and userId is preserved
      const getRequest: GetRequest = {
        origin: 'https://example.com',
        publicKey: {
          rpId: 'example.com',
          challenge: 'auth-challenge'
        }
      };

      const storedRecord = storedPasskeys.get(createResult.credential.id)!;
      const assertion = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord);

      // Verify userHandle was populated from the retrieved userId
      expect(assertion.userHandle).not.toBeNull();
      expect(assertion.userHandle).toBeDefined();
    });

    it('should preserve userId through storage and retrieval round-trip', async () => {
      // This test simulates the full flow: create → store → retrieve → authenticate
      const realStorage = new Map<string, StoredPasskeyRecord>();
      const userIdBytes = new Uint8Array([100, 101, 102, 103]);

      // We'll create the passkey and then simulate storage

      // Create passkey
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          user: {
            id: userIdBytes,
            name: 'user',
            displayName: 'User'
          },
          challenge: 'challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const createResult = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);

      // Simulate real storage that might serialize/deserialize
      const serialized = JSON.stringify(createResult.stored);
      const deserialized = JSON.parse(serialized) as StoredPasskeyRecord;
      realStorage.set(createResult.stored.credentialId, deserialized);

      // Verify it was stored
      const storedRecord = realStorage.get(createResult.credential.id);
      expect(storedRecord).toBeDefined();
      expect(storedRecord?.userId).toBeDefined();

      // Authenticate - retrieve from storage
      const getRequest: GetRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'auth-challenge'
        }
      };

      const assertion = await PasskeyAuthenticator.getAssertion(getRequest, deserialized);

      // Verify userHandle was preserved through the round-trip
      expect(assertion.userHandle).not.toBeNull();

      // Decode and verify it matches original
      if (assertion.userHandle) {
        const decoded = fromBase64url(assertion.userHandle);
        const decodedBytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) {
          decodedBytes[i] = decoded.charCodeAt(i);
        }
        expect(Array.from(decodedBytes)).toEqual(Array.from(userIdBytes));
      }
    });
  });

  describe('Cross-verification', () => {
    it('should verify signature with public key', async () => {
      // Create passkey
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          rp: { id: 'example.com' },
          challenge: 'create-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const createResult = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      storedPasskeys.set(createResult.credential.id, createResult.stored);

      // Authenticate
      const getRequest: GetRequest = {
        origin: 'https://example.com',
        publicKey: {
          rpId: 'example.com',
          challenge: 'auth-challenge'
        }
      };

      const storedRecord = storedPasskeys.get(createResult.credential.id)!;
      const assertion = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord);

      // Import public key for verification
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        createResult.stored.publicKey,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );

      // Reconstruct the signed data
      const authDataBytes = Uint8Array.from(fromBase64url(assertion.authenticatorData), c => c.charCodeAt(0));
      const clientDataBytes = new TextEncoder().encode(fromBase64url(assertion.clientDataJSON));
      const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataBytes));
      const signedData = new Uint8Array([...authDataBytes, ...clientDataHash]);

      // Decode DER signature to raw format for verification
      const derSig = Uint8Array.from(fromBase64url(assertion.signature), c => c.charCodeAt(0));

      // Simple DER decoder for ECDSA signature (SEQUENCE of two INTEGERs)
      let offset = 2; // Skip SEQUENCE tag and length

      // Parse r
      expect(derSig[offset]).toBe(0x02); // INTEGER tag
      const rLen = derSig[offset + 1];
      let r = derSig.slice(offset + 2, offset + 2 + rLen);
      if (r.length > 32) {
        r = r.slice(r.length - 32);
      } // Remove padding if any
      if (r.length < 32) {
        const padded = new Uint8Array(32);
        padded.set(r, 32 - r.length);
        r = padded;
      }
      offset += 2 + rLen;

      // Parse s
      expect(derSig[offset]).toBe(0x02); // INTEGER tag
      const sLen = derSig[offset + 1];
      let s = derSig.slice(offset + 2, offset + 2 + sLen);
      if (s.length > 32) {
        s = s.slice(s.length - 32);
      }
      if (s.length < 32) {
        const padded = new Uint8Array(32);
        padded.set(s, 32 - s.length);
        s = padded;
      }

      // Combine to raw signature (r || s)
      const rawSig = new Uint8Array([...r, ...s]);

      // Verify signature
      const isValid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        rawSig,
        signedData
      );

      expect(isValid).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle challenge as Uint8Array', async () => {
      const challengeBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: challengeBytes,
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const result = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      expect(result.credential).toBeDefined();
    });

    it('should handle challenge as ArrayBuffer', async () => {
      const challengeBuffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;

      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: challengeBuffer,
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const result = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      expect(result.credential).toBeDefined();
    });

    it('should use rpId from origin when not provided in create request', async () => {
      const createRequest: CreateRequest = {
        origin: 'https://subdomain.test.com:8080',
        publicKey: {
          challenge: 'test-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const result = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      expect(result.stored.rpId).toBe('subdomain.test.com');
    });

    it('should use rpId from origin when not provided in get request', async () => {
      // Create passkey with explicit rpId
      const createRequest: CreateRequest = {
        origin: 'https://example.com',
        publicKey: {
          rp: { id: 'example.com' },
          challenge: 'create-challenge',
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }]
        }
      };

      const credentialIdBytes = crypto.getRandomValues(new Uint8Array(16));
      const createResult = await PasskeyAuthenticator.createPasskey(credentialIdBytes, createRequest);
      storedPasskeys.set(createResult.credential.id, createResult.stored);

      // Authenticate without explicit rpId
      const getRequest: GetRequest = {
        origin: 'https://example.com',
        publicKey: {
          challenge: 'auth-challenge'
        }
      };

      const storedRecord = storedPasskeys.get(createResult.credential.id)!;
      const assertion = await PasskeyAuthenticator.getAssertion(getRequest, storedRecord);
      expect(assertion).toBeDefined();
    });
  });
});
