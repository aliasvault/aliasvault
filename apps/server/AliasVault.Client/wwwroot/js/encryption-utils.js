/**
 * Custom error class for crypto availability issues
 */
class CryptoNotAvailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CryptoNotAvailableError';
        // Prevent stack trace from being captured
        this.stack = '';
    }
}

/**
 * Check if crypto API is available and throw user-friendly error if not.
 */
function checkCryptoAvailable() {
    if (!window.crypto || !window.crypto.subtle) {
        const error = new CryptoNotAvailableError("Cryptographic operations are not available. Please ensure you are accessing AliasVault over HTTPS, as this is required for security features to work properly.");
        console.error(error.message);
        throw error;
    }
}

/**
 * Convert a Uint8Array to a base64 string.
 *
 * @param {Uint8Array} bytes - The bytes to encode.
 * @returns {string} The base64-encoded string.
 */
function bytesToBase64(bytes) {
    if (typeof bytes.toBase64 === 'function') {
        return bytes.toBase64();
    }

    const CHUNK_SIZE = 0x8000;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
        binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + CHUNK_SIZE));
    }
    return btoa(binary);
}

/**
 * Decode a base64 string to a Uint8Array.
 *
 * @param {string} base64 - The base64 string to decode.
 * @returns {Uint8Array} The decoded bytes.
 */
function base64ToBytes(base64) {
    if (typeof Uint8Array.fromBase64 === 'function') {
        return Uint8Array.fromBase64(base64);
    }
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

/**
 * AES (symmetric) encryption and decryption functions.
 * @type {{encrypt: (function(*, *): Promise<string>), decrypt: (function(*, *): Promise<string>), decryptBytes: (function(*, *): Promise<Uint8Array>)}}
 */
window.cryptoInterop = {
    encrypt: async function (plaintext, base64Key) {
        checkCryptoAvailable();

        const key = await window.crypto.subtle.importKey(
            "raw",
            base64ToBytes(base64Key),
            {
                name: "AES-GCM",
                length: 256,
            },
            false,
            ["encrypt"]
        );

        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoder = new TextEncoder();
        const encoded = encoder.encode(plaintext);

        const ciphertext = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            encoded
        );

        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), iv.length);

        return bytesToBase64(combined);
    },
    decrypt: async function (base64Ciphertext, base64Key) {
        checkCryptoAvailable();

        const key = await window.crypto.subtle.importKey(
            "raw",
            base64ToBytes(base64Key),
            {
                name: "AES-GCM",
                length: 256,
            },
            false,
            ["decrypt"]
        );

        const ivAndCiphertext = base64ToBytes(base64Ciphertext);
        const iv = ivAndCiphertext.subarray(0, 12);
        const ciphertext = ivAndCiphertext.subarray(12);

        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            ciphertext
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    },
    decryptBytes: async function (base64Ciphertext, base64Key) {
        checkCryptoAvailable();

        const key = await window.crypto.subtle.importKey(
            "raw",
            base64ToBytes(base64Key),
            {
                name: "AES-GCM",
                length: 256,
            },
            false,
            ["decrypt"]
        );

        const ivAndCiphertext = base64ToBytes(base64Ciphertext);
        const iv = ivAndCiphertext.subarray(0, 12);
        const ciphertext = ivAndCiphertext.subarray(12);

        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            ciphertext
        );

        return new Uint8Array(decrypted);
    },
    /**
     * Encrypts byte array using AES-256-GCM
     * @param {Uint8Array} plainBytes - The bytes to encrypt
     * @param {Uint8Array} keyBytes - The 32-byte encryption key
     * @returns {Promise<Uint8Array>} The encrypted data (nonce + ciphertext + tag)
     */
    encryptBytes: async function(plainBytes, keyBytes) {
        checkCryptoAvailable();

        const key = await window.crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );

        const nonce = window.crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: nonce },
            key,
            plainBytes
        );

        const ciphertextArray = new Uint8Array(ciphertext);
        const result = new Uint8Array(12 + ciphertextArray.length);
        result.set(nonce, 0);
        result.set(ciphertextArray, 12);

        return result;
    },
    /**
     * Decrypts byte array using AES-256-GCM
     * @param {Uint8Array} encryptedBytes - The encrypted data (nonce + ciphertext + tag)
     * @param {Uint8Array} keyBytes - The 32-byte encryption key
     * @returns {Promise<Uint8Array>} The decrypted data
     */
    decryptBytesRaw: async function(encryptedBytes, keyBytes) {
        checkCryptoAvailable();

        const key = await window.crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        const nonce = encryptedBytes.slice(0, 12);
        const ciphertextWithTag = encryptedBytes.slice(12);

        const plaintext = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: nonce },
            key,
            ciphertextWithTag
        );

        return new Uint8Array(plaintext);
    },
    /**
     * Generates random salt
     * @param {number} length - The length of the salt in bytes
     * @returns {Uint8Array} The random salt
     */
    generateSalt: function(length) {
        checkCryptoAvailable();
        return window.crypto.getRandomValues(new Uint8Array(length));
    }
};

/**
 * RSA (asymmetric) encryption and decryption functions.
 * @type {{decryptWithPrivateKey: (function(string, string): Promise<string>), encryptWithPublicKey: (function(string, string): Promise<string>), generateRsaKeyPair: (function(): Promise<{privateKey: string, publicKey: string}>)}}
 */
window.rsaInterop = {
    /**
     * Generates a new RSA key pair.
     * @returns {Promise<{publicKey: string, privateKey: string}>} A promise that resolves to an object containing the public and private keys as JWK strings.
     */
    generateRsaKeyPair : async function() {
        checkCryptoAvailable();

        const keyPair = await window.crypto.subtle.generateKey(
            {
                name: "RSA-OAEP",
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-256",
            },
            true,
            ["encrypt", "decrypt"]
        );

        const publicKey = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
        const privateKey = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);

        return {
            publicKey: JSON.stringify(publicKey),
            privateKey: JSON.stringify(privateKey)
        };
    },
    /**
     * Encrypts a plaintext string using an RSA public key.
     * @param {string} plaintext - The plaintext to encrypt.
     * @param {string} publicKey - The public key in JWK format.
     * @returns {Promise<string>} A promise that resolves to the encrypted data as a base64-encoded string.
     */
    encryptWithPublicKey : async function(plaintext, publicKey) {
        checkCryptoAvailable();

        const publicKeyObj = await window.crypto.subtle.importKey(
            "jwk",
            JSON.parse(publicKey),
            {
                name: "RSA-OAEP",
                hash: "SHA-256",
            },
            false,
            ["encrypt"]
        );

        const encodedPlaintext = new TextEncoder().encode(plaintext);
        const cipherBuffer = await window.crypto.subtle.encrypt(
            {
                name: "RSA-OAEP"
            },
            publicKeyObj,
            encodedPlaintext
        );

        return bytesToBase64(new Uint8Array(cipherBuffer));
    },
    /**
     * Decrypts a ciphertext string using an RSA private key.
     * @param {string} ciphertext - The base64-encoded ciphertext to decrypt.
     * @param {string} privateKey - The private key in JWK format.
     * @returns {Promise<string>} A promise that resolves to the decrypted data as a base64 string.
     */
    decryptWithPrivateKey: async function(ciphertext, privateKey) {
        checkCryptoAvailable();

        try {
            // Parse the private key
            let parsedPrivateKey = JSON.parse(privateKey);

            // Import the private key
            let privateKeyObj = await window.crypto.subtle.importKey(
                "jwk",
                parsedPrivateKey,
                {
                    name: "RSA-OAEP",
                    hash: "SHA-256",
                },
                true,
                ["decrypt"]
            );

            // Decode the base64 ciphertext
            let cipherBuffer = base64ToBytes(ciphertext);

            // Decrypt the ciphertext
            let plaintextBuffer = await window.crypto.subtle.decrypt(
                {
                    name: "RSA-OAEP",
                    hash: "SHA-256",
                },
                privateKeyObj,
                cipherBuffer
            );

            // Convert to base64 string instead of returning Uint8Array to avoid Blazor serialization issues, see https://github.com/dotnet/aspnetcore/issues/59837
            const decryptedBytes = new Uint8Array(plaintextBuffer);
            return bytesToBase64(decryptedBytes);
        } catch (error) {
            throw new Error(`Failed to decrypt: ${error.message}`);
        }
    }
};
