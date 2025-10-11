/**
 * WebAuthn override injection script - included in web_accessible_resources as "webauthn.js"
 * and runs in page context to override the browser's built-in credentials API.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  WebAuthnCreateEventDetail,
  WebAuthnGetEventDetail,
  WebAuthnCreateResponseDetail,
  WebAuthnGetResponseDetail,
  ProviderCreateCredential,
  ProviderGetCredential
} from '@/utils/passkey/webauthn.types';

import { defineUnlistedScript } from '#imports';

export default defineUnlistedScript(() => {
  // Only run once
  if ((window as any).__aliasVaultWebAuthnIntercepted) {
    return;
  }
  (window as any).__aliasVaultWebAuthnIntercepted = true;

  const originalCreate = navigator.credentials.create.bind(navigator.credentials);
  const originalGet = navigator.credentials.get.bind(navigator.credentials);

  /**
   * Helper to convert ArrayBuffer to base64
   */
  function bufferToBase64(buffer: ArrayBuffer | ArrayBufferView): string {
    const bytes = buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, (buffer as any).byteOffset, (buffer as any).byteLength);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Helper to convert ArrayBuffer to base64
   */
  function base64ToBuffer(base64: string): ArrayBuffer {
    // Handle both base64 and base64url formats
    const base64Standard = base64.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    const padded = base64Standard + '==='.slice((base64Standard.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Override credentials.create (monkey patch)
   */
  navigator.credentials.create = async function(options?: CredentialCreationOptions) : Promise<Credential | null> {
    if (!options?.publicKey) {
      return originalCreate(options);
    }

    console.debug('[AliasVault] Page: Received credential CREATE request with options:', options);

    // Send event to content script
    const requestId = Math.random().toString(36).substr(2, 9);
    const eventDetail: WebAuthnCreateEventDetail = {
      requestId,
      publicKey: {
        ...options.publicKey,
        challenge: bufferToBase64(options.publicKey.challenge),
        user: {
          ...options.publicKey.user,
          id: bufferToBase64(options.publicKey.user.id)
        },
        excludeCredentials: options.publicKey.excludeCredentials?.map(cred => ({
          ...cred,
          id: bufferToBase64(cred.id)
        })),
        extensions: options.publicKey.extensions
      },
      origin: window.location.origin
    };
    const event = new CustomEvent<WebAuthnCreateEventDetail>('aliasvault:webauthn:create', {
      detail: eventDetail
    });
    window.dispatchEvent(event);

    // Wait for response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        // Timeout - fall back to native
        originalCreate(options).then(resolve).catch(reject);
      }, 30000); // 30 second timeout

      /**
       * cleanup
       */
      function cleanup() : void {
        clearTimeout(timeout);
        window.removeEventListener('aliasvault:webauthn:create:response', handler as EventListener);
      }

      /**
       * handler
       */
      function handler(e: CustomEvent<WebAuthnCreateResponseDetail>) : void {
        if (e.detail.requestId !== requestId) {
          return;
        }

        cleanup();

        if (e.detail.fallback) {
          // User chose to use native implementation
          originalCreate(options).then(resolve).catch(reject);
        } else if (e.detail.error) {
          reject(new Error(e.detail.error));
        } else if (e.detail.credential) {
          // Create a proper credential object with required methods
          const cred: ProviderCreateCredential = e.detail.credential;
          try {
            // Decode the attestation object to extract authenticator data
            const attestationObjectBuffer = base64ToBuffer(cred.attestationObject);
            const attObjBytes = new Uint8Array(attestationObjectBuffer);

            /*
             * Simple CBOR parser to extract authData
             * CBOR map starts with 0xA3 (map with 3 items)
             * Keys are: "fmt" (0x63), "attStmt" (0x67), "authData" (0x68)
             */
            let authDataBuffer = new ArrayBuffer(0);
            try {
              // Find "authData" key (0x68 0x61 0x75 0x74 0x68 0x44 0x61 0x74 0x61)
              const authDataKeyBytes = [0x68, 0x61, 0x75, 0x74, 0x68, 0x44, 0x61, 0x74, 0x61];
              for (let i = 0; i < attObjBytes.length - authDataKeyBytes.length; i++) {
                let match = true;
                for (let j = 0; j < authDataKeyBytes.length; j++) {
                  if (attObjBytes[i + j] !== authDataKeyBytes[j]) {
                    match = false;
                    break;
                  }
                }
                if (match) {
                  // Found "authData" key, next byte is the type (0x58 = byte string)
                  const typeIdx = i + authDataKeyBytes.length;
                  if (attObjBytes[typeIdx] === 0x58) {
                    // Next byte is the length
                    const length = attObjBytes[typeIdx + 1];
                    authDataBuffer = attObjBytes.slice(typeIdx + 2, typeIdx + 2 + length).buffer;
                  }
                  break;
                }
              }
            } catch (e) {
              console.error('[AliasVault] Failed to parse authData from attestation object:', e);
            }

            const credential = {
              id: cred.id,
              type: 'public-key',
              rawId: base64ToBuffer(cred.rawId),
              authenticatorAttachment: 'cross-platform',
              response: {
                clientDataJSON: base64ToBuffer(cred.clientDataJSON),
                attestationObject: attestationObjectBuffer,
                /**
                 * getTransports
                 */
                getTransports() : string[] {
                  return ['internal'];
                },
                /**
                 * getAuthenticatorData
                 */
                getAuthenticatorData() : ArrayBuffer {
                  return authDataBuffer;
                },
                /**
                 * getPublicKey
                 */
                getPublicKey() : JsonWebKey | null {
                  return null;
                },
                /**
                 * getPublicKeyAlgorithm
                 */
                getPublicKeyAlgorithm() : number {
                  return -7; // ES256
                }
              },
              /**
               * getClientExtensionResults
               */
              getClientExtensionResults() : any {
                const extensions: any = {};
                if (cred.extensions?.prf) {
                  extensions.prf = cred.extensions.prf;
                }
                return extensions;
              }
            };
            console.debug('[AliasVault] Page: Returned created credential object:', credential);
            resolve(credential as any);
          } catch (error) {
            console.error('[AliasVault] Page: Error creating credential object:', error);
            reject(error);
          }
        } else {
          // Cancelled
          resolve(null);
        }
      }

      window.addEventListener('aliasvault:webauthn:create:response', handler as EventListener);
    });
  };

  /**
   * Override credentials.get (monkey patch)
   */
  navigator.credentials.get = async function(options?: CredentialRequestOptions) : Promise<Credential | null> {
    if (!options?.publicKey) {
      return originalGet(options);
    }

    console.debug('[AliasVault] Page: Received credential GET request with options:', options);

    // Send event to content script
    const requestId = Math.random().toString(36).substr(2, 9);

    // Serialize PRF extensions if present (convert ArrayBuffers to base64)
    let serializedExtensions: any = undefined;
    if (options.publicKey.extensions) {
      serializedExtensions = { ...options.publicKey.extensions };
      if (serializedExtensions.prf?.eval) {
        const prfEval: any = { first: bufferToBase64(serializedExtensions.prf.eval.first) };
        if (serializedExtensions.prf.eval.second) {
          prfEval.second = bufferToBase64(serializedExtensions.prf.eval.second);
        }
        serializedExtensions.prf = { eval: prfEval };
      }
    }

    const eventDetail: WebAuthnGetEventDetail = {
      requestId,
      publicKey: {
        ...options.publicKey,
        challenge: bufferToBase64(options.publicKey.challenge),
        allowCredentials: options.publicKey.allowCredentials?.map(cred => ({
          ...cred,
          id: bufferToBase64(cred.id)
        })),
        extensions: serializedExtensions
      },
      origin: window.location.origin
    };
    console.debug('[AliasVault] Page: Sending GET request with serialized extensions:', eventDetail);
    const event = new CustomEvent<WebAuthnGetEventDetail>('aliasvault:webauthn:get', {
      detail: eventDetail
    });
    window.dispatchEvent(event);

    // Wait for response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        // Timeout - fall back to native
        originalGet(options).then(resolve).catch(reject);
      }, 30000);

      /**
       * cleanup
       */
      function cleanup() : void {
        clearTimeout(timeout);
        window.removeEventListener('aliasvault:webauthn:get:response', handler as EventListener);
      }

      /**
       * handler
       */
      function handler(e: CustomEvent<WebAuthnGetResponseDetail>) : void {
        if (e.detail.requestId !== requestId) {
          return;
        }

        cleanup();

        if (e.detail.fallback) {
          // User chose to use native implementation
          originalGet(options).then(resolve).catch(reject);
        } else if (e.detail.error) {
          reject(new Error(e.detail.error));
        } else if (e.detail.credential) {
          // Create a proper credential object with required methods
          const cred: ProviderGetCredential = e.detail.credential;
          console.debug('[AliasVault] Page: Returned GET credential readable object:', cred);
          console.debug('[AliasVault] Page: PRF Results from credential:', cred.prfResults);
          const credential = {
            id: cred.id,
            type: 'public-key',
            rawId: base64ToBuffer(cred.rawId),
            authenticatorAttachment: 'cross-platform',
            response: {
              clientDataJSON: base64ToBuffer(cred.clientDataJSON),
              authenticatorData: base64ToBuffer(cred.authenticatorData),
              signature: base64ToBuffer(cred.signature),
              userHandle: cred.userHandle ? base64ToBuffer(cred.userHandle) : null
            },
            /**
             * getClientExtensionResults
             */
            getClientExtensionResults() : any {
              const extensions: any = {};
              if (cred.prfResults) {
                extensions.prf = {
                  results: {
                    first: base64ToBuffer(cred.prfResults.first)
                  }
                };
                if (cred.prfResults.second) {
                  extensions.prf.results.second = base64ToBuffer(cred.prfResults.second);
                }
              }
              return extensions;
            }
          };

          console.debug('[AliasVault] Page: Returned GET credential raw object:', credential);
          resolve(credential as any);
        } else {
          // Cancelled
          resolve(null);
        }
      }

      window.addEventListener('aliasvault:webauthn:get:response', handler as EventListener);
    });
  };

  console.debug('[AliasVault] WebAuthn inject script loaded successfully');
});
