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

  // Get the original implementations from the reservation script or bind directly
  const queue = (window as any).__aliasVaultWebAuthnQueue;
  const originalCreate = queue?.originalCreate || navigator.credentials.create.bind(navigator.credentials);
  const originalGet = queue?.originalGet || navigator.credentials.get.bind(navigator.credentials);
  const pendingQueue = queue?.pendingQueue || [];

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
        extensions: serializedExtensions
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
            } catch {
              // Ignore
            }

            // Create response object with proper prototype
            const response = Object.create(AuthenticatorAttestationResponse.prototype);
            const clientDataJSONBuffer = base64ToBuffer(cred.clientDataJSON);
            Object.defineProperties(response, {
              clientDataJSON: {
                value: clientDataJSONBuffer,
                writable: false,
                enumerable: true,
                configurable: true
              },
              attestationObject: {
                value: attestationObjectBuffer,
                writable: false,
                enumerable: true,
                configurable: true
              },
              getTransports: {
                /**
                 * getTransports
                 */
                value: function() : string[] {
                  return ['internal'];
                },
                writable: true,
                enumerable: true,
                configurable: true
              },
              getAuthenticatorData: {
                /**
                 * getAuthenticatorData
                 */
                value: function() : ArrayBuffer {
                  return authDataBuffer;
                },
                writable: true,
                enumerable: true,
                configurable: true
              },
              getPublicKey: {
                /**
                 * getPublicKey
                 */
                value: function() : JsonWebKey | null {
                  return null;
                },
                writable: true,
                enumerable: true,
                configurable: true
              },
              getPublicKeyAlgorithm: {
                /**
                 * getPublicKeyAlgorithm
                 */
                value: function() : number {
                  return -7; // ES256
                },
                writable: true,
                enumerable: true,
                configurable: true
              }
            });

            // Create credential object with proper prototype chain
            const credential = Object.create(PublicKeyCredential.prototype);
            Object.defineProperties(credential, {
              id: {
                value: cred.id,
                writable: false,
                enumerable: true,
                configurable: true
              },
              type: {
                value: 'public-key',
                writable: false,
                enumerable: true,
                configurable: true
              },
              rawId: {
                value: base64ToBuffer(cred.rawId),
                writable: false,
                enumerable: true,
                configurable: true
              },
              authenticatorAttachment: {
                value: 'cross-platform',
                writable: false,
                enumerable: true,
                configurable: true
              },
              response: {
                value: response,
                writable: false,
                enumerable: true,
                configurable: true
              },
              getClientExtensionResults: {
                /**
                 * getClientExtensionResults
                 */
                value: function() : any {
                  const extensions: any = {};
                  if (cred.extensions?.prf) {
                    extensions.prf = { ...cred.extensions.prf };
                    // Convert PRF results from base64url to ArrayBuffer if present
                    if ((cred.extensions.prf as any).results) {
                      extensions.prf.results = {
                        first: base64ToBuffer((cred.extensions.prf as any).results.first)
                      };
                      if ((cred.extensions.prf as any).results.second) {
                        extensions.prf.results.second = base64ToBuffer((cred.extensions.prf as any).results.second);
                      }
                    }
                  }
                  return extensions;
                },
                writable: true,
                enumerable: true,
                configurable: true
              }
            });

            // Ensure the credential is recognized as a PublicKeyCredential instance
            Object.defineProperty(credential, Symbol.toStringTag, {
              value: 'PublicKeyCredential',
              writable: false,
              enumerable: false,
              configurable: true
            });

            resolve(credential);
          } catch (error) {
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

          // Create response object with proper prototype
          const response = Object.create(AuthenticatorAssertionResponse.prototype);
          Object.defineProperties(response, {
            clientDataJSON: {
              value: base64ToBuffer(cred.clientDataJSON),
              writable: false,
              enumerable: true,
              configurable: true
            },
            authenticatorData: {
              value: base64ToBuffer(cred.authenticatorData),
              writable: false,
              enumerable: true,
              configurable: true
            },
            signature: {
              value: base64ToBuffer(cred.signature),
              writable: false,
              enumerable: true,
              configurable: true
            },
            userHandle: {
              value: cred.userHandle ? base64ToBuffer(cred.userHandle) : null,
              writable: false,
              enumerable: true,
              configurable: true
            }
          });

          // Create credential object with proper prototype chain
          const credential = Object.create(PublicKeyCredential.prototype);
          Object.defineProperties(credential, {
            id: {
              value: cred.id,
              writable: false,
              enumerable: true,
              configurable: true
            },
            type: {
              value: 'public-key',
              writable: false,
              enumerable: true,
              configurable: true
            },
            rawId: {
              value: base64ToBuffer(cred.rawId),
              writable: false,
              enumerable: true,
              configurable: true
            },
            authenticatorAttachment: {
              value: 'cross-platform',
              writable: false,
              enumerable: true,
              configurable: true
            },
            response: {
              value: response,
              writable: false,
              enumerable: true,
              configurable: true
            },
            getClientExtensionResults: {
              /**
               * getClientExtensionResults
               */
              value: function() : any {
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
              },
              writable: true,
              enumerable: true,
              configurable: true
            }
          });

          // Ensure the credential is recognized as a PublicKeyCredential instance
          Object.defineProperty(credential, Symbol.toStringTag, {
            value: 'PublicKeyCredential',
            writable: false,
            enumerable: false,
            configurable: true
          });

          resolve(credential);
        } else {
          // Cancelled
          resolve(null);
        }
      }

      window.addEventListener('aliasvault:webauthn:get:response', handler as EventListener);
    });
  };

  /*
   * Store references to our override functions so we can re-apply them if needed.
   * We need to capture these before any potential overwrites.
   */
  const getOverrideRef = navigator.credentials.get;
  const createOverrideRef = navigator.credentials.create;

  // Add markers to our functions for easier verification
  (getOverrideRef as any).__aliasVaultPatched = true;
  (createOverrideRef as any).__aliasVaultPatched = true;

  /**
   * Apply or re-apply the monkey patches
   */
  const applyPatches = (): void => {
    const currentGet = navigator.credentials.get;
    const currentCreate = navigator.credentials.create;

    // Re-apply get if it's missing our marker
    if (!(currentGet as any).__aliasVaultPatched) {
      console.debug('[AliasVault] Re-applying credentials.get patch');
      navigator.credentials.get = getOverrideRef;
    }

    // Re-apply create if it's missing our marker
    if (!(currentCreate as any).__aliasVaultPatched) {
      console.debug('[AliasVault] Re-applying credentials.create patch');
      navigator.credentials.create = createOverrideRef;
    }
  };

  /**
   * Verification function to check if monkey patches are still in place
   * @returns True if patches are verified, false otherwise
   */
  const verifyPatches = (): boolean => {
    const get = navigator.credentials.get;
    const create = navigator.credentials.create;

    // Check for our marker
    if (!(get as any).__aliasVaultPatched || !(create as any).__aliasVaultPatched) {
      console.debug('[AliasVault] WebAuthn patch markers missing', {
        hasGetMarker: !!(get as any).__aliasVaultPatched,
        hasCreateMarker: !!(create as any).__aliasVaultPatched
      });
      return false;
    }

    return true;
  };

  // Verify immediately
  if (!verifyPatches()) {
    console.debug('[AliasVault] WebAuthn initial patch markers missing - re-applying patches');
    applyPatches();
  }

  // Periodic verification for first 5 seconds (catches if something overwrites us)
  let checkCount = 0;
  const verifyInterval = setInterval(() => {
    checkCount++;
    if (!verifyPatches()) {
      console.debug('[AliasVault] WebAuthn periodic patch markers missing - re-applying patches');
      applyPatches();
    }

    if (checkCount >= 10) {
      clearInterval(verifyInterval);
    }
  }, 500);

  /*
   * Process any queued requests from the reservation script.
   * This handles the case where the page called navigator.credentials
   * before our full implementation finished loading.
   */
  if (pendingQueue.length > 0) {
    pendingQueue.forEach((request: any) => {
      if (request.type === 'create') {
        navigator.credentials.create(request.options)
          .then(request.resolve)
          .catch(request.reject);
      } else if (request.type === 'get') {
        navigator.credentials.get(request.options)
          .then(request.resolve)
          .catch(request.reject);
      }
    });
    // Clear the queue
    pendingQueue.length = 0;
  }

  // Clean up the reservation script globals
  delete (window as any).__aliasVaultWebAuthnQueue;
  delete (window as any).__aliasVaultWebAuthnReserved;
});
