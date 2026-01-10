/**
 * Test API utilities for E2E tests.
 *
 * This module provides utilities for interacting with the AliasVault API
 * during E2E tests, including user registration using SRP protocol.
 *
 * Note: This module uses Node.js native argon2 for password hashing,
 * while the browser extension uses argon2-browser. The SRP protocol
 * logic is shared where possible.
 */

// Import argon2 for Node.js environment (different from browser version)
import { webcrypto } from 'crypto';
import { readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import argon2 from 'argon2';
import Database from 'better-sqlite3';
import * as srp from 'secure-remote-password/client.js';

// Get the vault schema SQL from the core vault package
import { COMPLETE_SCHEMA_SQL, VAULT_VERSIONS } from '../../src/utils/dist/core/vault/index.mjs';

/**
 * Token model returned from successful registration/login.
 */
export type TokenModel = {
  token: string;
  refreshToken: string;
};

/**
 * Test user credentials.
 */
export type TestUser = {
  username: string;
  password: string;
  token?: TokenModel;
};

/**
 * Vault upload request payload.
 */
type VaultUploadRequest = {
  username: string;
  blob: string;
  version: string;
  currentRevisionNumber: number;
  encryptionPublicKey: string;
  credentialsCount: number;
  emailAddressList: string[];
  privateEmailDomainList: string[];
  hiddenPrivateEmailDomainList: string[];
  publicEmailDomainList: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Registration request payload.
 * This matches the server's RegisterRequest model.
 */
type RegisterRequest = {
  username: string;
  salt: string;
  verifier: string;
  encryptionType: string;
  encryptionSettings: string;
};

/**
 * Default encryption settings for Argon2Id.
 * These match the server defaults in AliasVault.Cryptography.Client/Defaults.cs
 */
const DEFAULT_ENCRYPTION = {
  type: 'Argon2Id',
  settings: JSON.stringify({
    DegreeOfParallelism: 1,
    MemorySize: 19456,
    Iterations: 2,
  }),
  // Parsed settings for argon2 usage
  iterations: 2,
  memorySize: 19456,
  parallelism: 1,
};

/**
 * Normalizes a username by converting to lowercase and trimming whitespace.
 * This matches the server's username normalization.
 */
export function normalizeUsername(username: string): string {
  return username.toLowerCase().trim();
}

/**
 * Generates a random test username.
 */
export function generateTestUsername(): string {
  const randomPart = Math.random().toString(36).substring(2, 12);
  return `test_${randomPart}@example.tld`;
}

/**
 * Generates a random test password.
 */
export function generateTestPassword(): string {
  return `TestPass_${Math.random().toString(36).substring(2, 15)}!`;
}

/**
 * Converts a Uint8Array to an uppercase hex string.
 */
function bytesToHexString(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Derives a key from password using Argon2Id (Node.js version).
 *
 * Note: This uses the native argon2 module for Node.js, which is different
 * from the argon2-browser WASM module used in the browser extension.
 *
 * @param password - The password to derive the key from
 * @param salt - The salt string
 * @returns The derived key as Uint8Array
 */
async function deriveKeyFromPassword(password: string, salt: string): Promise<Uint8Array> {
  // Note: argon2 in Node.js expects salt as Buffer
  const saltBuffer = Buffer.from(salt, 'utf8');

  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    salt: saltBuffer,
    timeCost: DEFAULT_ENCRYPTION.iterations,
    memoryCost: DEFAULT_ENCRYPTION.memorySize,
    parallelism: DEFAULT_ENCRYPTION.parallelism,
    hashLength: 32,
    raw: true,
  });

  return new Uint8Array(hash);
}

/**
 * Encrypts data using AES-GCM symmetric encryption (matching the browser extension's EncryptionUtility).
 *
 * @param plaintext - The plaintext string to encrypt
 * @param keyBytes - The 256-bit encryption key as Uint8Array
 * @returns Base64-encoded ciphertext (IV prepended to ciphertext)
 */
async function symmetricEncrypt(plaintext: string, keyBytes: Uint8Array): Promise<string> {
  const key = await webcrypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // Generate random 12-byte IV
  const iv = webcrypto.getRandomValues(new Uint8Array(12));

  // Encode plaintext to bytes
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);

  // Encrypt
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintextBytes);

  // Prepend IV to ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  // Convert to base64
  return Buffer.from(combined).toString('base64');
}

/**
 * Creates an empty vault database with the latest schema.
 *
 * @returns Base64-encoded SQLite database
 */
function createEmptyVaultDatabase(): string {
  // Create a temporary file for the database
  const tempPath = join(tmpdir(), `vault_${Date.now()}_${Math.random().toString(36).substring(2)}.db`);

  try {
    // Create a new SQLite database
    const db = new Database(tempPath);

    // Execute the complete schema SQL to create all tables
    // The schema is a series of SQL statements separated by semicolons
    db.exec(COMPLETE_SCHEMA_SQL);

    // Close the database
    db.close();

    // Read the database file and convert to base64
    const dbBytes = readFileSync(tempPath);
    return Buffer.from(dbBytes).toString('base64');
  } finally {
    // Clean up the temp file
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Generates an RSA key pair for the vault's encryption key.
 *
 * @returns Object with public and private keys as JSON strings
 */
async function generateRsaKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await webcrypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  );

  const publicKey = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKey = await webcrypto.subtle.exportKey('jwk', keyPair.privateKey);

  return {
    publicKey: JSON.stringify(publicKey),
    privateKey: JSON.stringify(privateKey),
  };
}

/**
 * Prepares SRP registration data for a new user.
 *
 * @param username - The username for registration
 * @param password - The password for registration
 * @returns Registration request data and the encryption key
 */
async function prepareRegistration(
  username: string,
  password: string
): Promise<{ request: RegisterRequest; salt: string; encryptionKey: Uint8Array }> {
  const normalizedUsername = normalizeUsername(username);

  // Generate salt using SRP client
  const salt = srp.generateSalt();

  // Derive key from password using Argon2Id
  const encryptionKey = await deriveKeyFromPassword(password, salt);

  // Convert to uppercase hex string (expected by server)
  const passwordHashString = bytesToHexString(encryptionKey);

  // Generate SRP private key and verifier
  const privateKey = srp.derivePrivateKey(salt, normalizedUsername, passwordHashString);
  const verifier = srp.deriveVerifier(privateKey);

  return {
    request: {
      username: normalizedUsername,
      salt,
      verifier,
      encryptionType: DEFAULT_ENCRYPTION.type,
      encryptionSettings: DEFAULT_ENCRYPTION.settings,
    },
    salt,
    encryptionKey,
  };
}

/**
 * Uploads an initial empty vault to the server.
 *
 * @param apiBaseUrl - The base URL of the API
 * @param token - The authentication token
 * @param username - The username
 * @param encryptionKey - The encryption key as Uint8Array
 */
async function uploadInitialVault(
  apiBaseUrl: string,
  token: string,
  username: string,
  encryptionKey: Uint8Array
): Promise<void> {
  const baseUrl = apiBaseUrl.replace(/\/$/, '') + '/v1/';

  // Create an empty vault database
  const vaultBase64 = createEmptyVaultDatabase();

  // Encrypt the vault
  const encryptedVault = await symmetricEncrypt(vaultBase64, encryptionKey);

  // Generate RSA key pair for the vault
  const rsaKeyPair = await generateRsaKeyPair();

  // Prepare the vault upload request
  const now = new Date().toISOString();
  const vaultRequest: VaultUploadRequest = {
    username: normalizeUsername(username),
    blob: encryptedVault,
    version: VAULT_VERSIONS[VAULT_VERSIONS.length - 1].version,
    currentRevisionNumber: 1,
    encryptionPublicKey: rsaKeyPair.publicKey,
    credentialsCount: 0,
    emailAddressList: [],
    privateEmailDomainList: [],
    hiddenPrivateEmailDomainList: [],
    publicEmailDomainList: [],
    createdAt: now,
    updatedAt: now,
  };

  // Upload the vault
  const response = await fetch(`${baseUrl}Vault`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(vaultRequest),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upload initial vault: ${response.status} ${errorText}`);
  }
}

/**
 * Registers a new test user via the API using SRP protocol and initializes their vault.
 *
 * @param apiBaseUrl - The base URL of the API (e.g., 'http://localhost:5092')
 * @param username - The username for the new account
 * @param password - The password for the new account
 * @returns The token model on success
 * @throws Error if registration fails
 */
export async function registerTestUser(
  apiBaseUrl: string,
  username: string,
  password: string
): Promise<TokenModel> {
  // Normalize the API URL
  const baseUrl = apiBaseUrl.replace(/\/$/, '') + '/v1/';

  // Prepare registration data
  const { request: registerRequest, encryptionKey } = await prepareRegistration(username, password);

  // Send registration request to API
  const response = await fetch(`${baseUrl}Auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(registerRequest),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Registration failed with status ${response.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.title || errorJson.message || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  const tokenModel = (await response.json()) as TokenModel;

  // Upload initial empty vault
  await uploadInitialVault(apiBaseUrl, tokenModel.token, username, encryptionKey);

  return tokenModel;
}

/**
 * Creates a test user with random credentials.
 *
 * @param apiBaseUrl - The base URL of the API
 * @returns A TestUser object with credentials and token
 */
export async function createTestUser(apiBaseUrl: string): Promise<TestUser> {
  const username = generateTestUsername();
  const password = generateTestPassword();

  const token = await registerTestUser(apiBaseUrl, username, password);

  return {
    username,
    password,
    token,
  };
}

/**
 * Checks if the API is available.
 *
 * @param apiBaseUrl - The base URL of the API
 * @returns True if the API is reachable
 */
export async function isApiAvailable(apiBaseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/v1/Auth/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    // The status endpoint returns 401 when not authenticated, but that means the API is running
    return response.status === 401 || response.ok;
  } catch {
    return false;
  }
}
