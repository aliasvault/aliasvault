# ARCHITECTURE.md
This document provides a high-level overview of the AliasVault architecture, focusing on the encryption algorithms used to ensure the security of user data.

## Overview
AliasVault implements zero-knowledge encryption using a combination of encryption algorithms to protect the privacy of its users.

The basic premise is that the master password chosen by the user upon registration forms the basis for all encryption and decryption operations. This master password is never transmitted over the network and only resides on the client.

### What is Zero-Knowledge Encrypted
- **Vault Data**: Your entire vault (passwords, usernames, notes, passkeys, email addresses, etc.) is fully encrypted client-side before being sent to the server. The server cannot decrypt any vault contents.
- **Email Contents**: When emails are received by the server, their contents are immediately encrypted with your public key (from your vault) before being saved. Only you can decrypt and read these emails with your private key.

This ensures that even if the AliasVault servers are compromised, vault contents and email messages remain secure and unreadable.

## Encryption algorithms
The following encryption algorithms and standards are used by AliasVault:

### Core Vault Encryption
- [Argon2id](#argon2id) - Key derivation from master password
- [SRP](#srp) - Secure authentication protocol
- [AES-GCM](#aes-gcm) - Vault data encryption

### Additional Features
- [RSA-OAEP](#rsa-oaep) - Email encryption
- [Passkeys (WebAuthn)](#passkeys-webauthn) - Passwordless authentication
- [Login with Mobile](#login-with-mobile) - Unlock vault in web app / browser extension via mobile app

Below is a detailed explanation of each encryption algorithm and standard.

For more information about how these algorithms are specifically used in AliasVault, see the [Architecture Documentation](https://docs.aliasvault.net/architecture) section on the documentation site.

### Argon2id
To derive a key from the master password, AliasVault uses the Argon2id key derivation function. Argon2id is a memory-hard
key derivation function which allows for controlling the execution time, memory required and degree of parallelism.
This makes it resilient against brute-force attacks and makes it one of the best choices for deriving keys from passwords.

AliasVault uses Argon2id with the following default parameters:
- Degree of parallelism: 1
- Memory size: 19456 KB
- Iterations: 2

More information about Argon2id can be found on the [Argon2](https://en.wikipedia.org/wiki/Argon2) Wikipedia page.

### SRP
The Secure Remote Password (SRP) protocol is used for authenticating a user with the AliasVault server during login.
The SRP protocol is a password-authenticated key exchange protocol (PAKE). This means that the client and server can
authenticate each other using a password, without sending the password itself over the network.

With the use of SRP the master password never leaves the client. The client sends a verifier to the server,
which is a value derived from the master password. The server uses this verifier to authenticate the client without
having ever seen the actual master password.

For more information see the [SRP protocol](https://en.wikipedia.org/wiki/Secure_Remote_Password_protocol) information on Wikipedia.

### AES-256-GCM
All user's vault data is fully encrypted on the client using the AES-256-GCM encryption algorithm, which stands for
*Advanced Encryption Standard with 256-bit key in Galois/Counter Mode*. The key for encryption is derived from the
master password by using the Argon2Id algorithm. AliasVault implements AES-GCM with the following specifications:

- Key Size: 256 bits
- Uses the Web Crypto API's SubtleCrypto interface for secure cryptographic operations
- Generates a random 12-byte (96-bit) IV (initialization vector) for each encryption operation
- Performs all encryption/decryption operations entirely in the browser

#### The encryption process works as follows:
- A unique IV is generated for each encryption operation
- The users vault data is encrypted using AES-GCM with the derived key and IV
- The IV is prepended to the ciphertext

More information about AES-GCM can be found on the [AES-GCM](https://en.wikipedia.org/wiki/Galois/Counter_Mode) Wikipedia page.

### RSA-OAEP
To secure email communications, AliasVault uses RSA-OAEP (RSA with Optimal Asymmetric Encryption Padding). This asymmetric
encryption system allows AliasVault to store emails on the server in encrypted state which can only be read by the
intended recipient. AliasVault implements RSA-OAEP with the following specifications:
- Algorithm: RSA-OAEP with SHA-256 hash
- Key Size: 2048-bit modulus
- Key Format: JWK (JSON Web Key)
- Padding: OAEP (Optimal Asymmetric Encryption Padding)

#### Email Security Flow
1. Key Generation: When a user creates a vault, a RSA key pair is generated:
   - A private key that remains in the encrypted user's vault and is never transmitted
   - A public key that is sent to the server

2. Email Reception Process: When an email arrives at the AliasVault email server:
   - The server generates a random 256-bit symmetric encryption key to encrypt the email contents
   - The symmetric encryption key is encrypted using the recipient's asymmetric public key
   - The encrypted email contents together with the encrypted symmetric encryption key are stored in the server's database
   - The original email content is never stored or logged

3. Email Retrieval Process:
   - When a user accesses their emails, the encrypted content is retrieved from the server
   - The client-side application decrypts the symmetric encryption key using the user's private key that is stored in their vault
   - The decrypted symmetric encryption key is used to decrypt the email contents
   - Decryption occurs entirely in the browser, maintaining end-to-end encryption

This implementation ensures that:
- Emails are encrypted and secure at rest in the server database
- Only the intended recipient that holds the private key can decrypt and read their emails
- Even if the server is compromised, email contents remain encrypted and unreadable

More information about RSA-OAEP can be found on the [RSA-OAEP](https://en.wikipedia.org/wiki/Optimal_asymmetric_encryption_padding) Wikipedia page.

### Passkeys (WebAuthn)
AliasVault includes a virtual passkey authenticator that is fully compatible with the WebAuthn Level 2 specification. This enables users to securely store and use passkeys across their devices through the encrypted vault, providing a seamless and secure alternative to traditional password authentication.

#### Implementation Details
AliasVault implements passkey functionality across all supported platforms:
- **Browser Extension**: Virtual authenticator using the Web Crypto API
- **iOS**: Native Swift implementation using CryptoKit
- **Android**: Native Kotlin implementation using AndroidKeyStore

All implementations follow the WebAuthn Level 2 specification and use:
- ES256 (ECDSA P-256) for key pair generation
- CBOR/COSE encoding for attestation objects
- Proper authenticator data with WebAuthn flags (UP, UV, BE, BS, AT)
- AliasVault AAGUID (Authenticator Attestation GUID): `a11a5faa-9f32-4b8c-8c5d-2f7d13e8c942`
- Self-attestation (packed format) or none attestation
- Sign count always 0 for syncable passkeys
- BE/BS flags indicating backup-eligible and backed-up status

#### Key Features
1. **Zero-Knowledge Passkey Storage**: Passkey private keys are stored as encrypted entries in the user's vault alongside passwords and other credentials. The server never has access to the unencrypted private keys.

2. **Cross-Platform Sync**: Passkeys automatically sync across all devices where the user's vault is accessible, enabling seamless authentication on any platform (browser extension, iOS app, or Android app).

3. **PRF Extension Support**: Implements the hmac-secret (PRF) extension, allowing relying parties to derive additional secrets from passkeys for encryption keys or other cryptographic operations. Currently supported on browser extension and iOS; Android support is pending due to limited Android API support.

4. **Standards Compliance**: Full adherence to WebAuthn Level 2 specification ensures compatibility with all WebAuthn-compliant relying parties and services.

#### Security Benefits
- Private keys remain encrypted in the vault at all times
- All passkey operations (key generation, signing) occur on the client device
- Passkeys benefit from the same zero-knowledge architecture as passwords
- Cross-device sync provides convenience without compromising security
- Eliminates phishing risks through cryptographic domain binding

More information about WebAuthn can be found on the [WebAuthn specification](https://www.w3.org/TR/webauthn-2/) page.

### Login with Mobile
AliasVault provides a secure "Login with Mobile" feature that allows users to unlock their vault on web browsers or browser extensions by scanning a QR code with their authenticated mobile app. This convenient authentication method maintains zero-knowledge security through hybrid encryption.

#### Implementation Details
The mobile login system combines RSA-2048 asymmetric encryption with AES-256-GCM symmetric encryption:

1. **Initiation**: Browser/extension client generates an RSA-2048 key pair locally and sends the public key to the server, which returns a unique request ID displayed as a QR code.

2. **Authorization**: Mobile app scans the QR code, encrypts the user's vault decryption key with the RSA public key, and sends it to the server.

3. **Retrieval**: Browser client polls the server for completion. When ready, the server:
   - Generates fresh JWT tokens for the session
   - Creates a random AES-256 symmetric key
   - Encrypts tokens and username with the symmetric key
   - Encrypts the symmetric key with the client's RSA public key
   - Returns encrypted data and immediately purges it from the database

4. **Decryption**: Client uses its RSA private key to decrypt the symmetric key, then uses the symmetric key to decrypt tokens and username, and the RSA private key to decrypt the vault decryption key.

#### Security Properties
- **Zero-Knowledge**: Server never accesses the vault decryption key in plaintext
- **One-Time Use**: Requests cannot be retrieved twice; data is immediately cleared after retrieval
- **Automatic Expiration**: Unfulfilled requests expire after 2 minutes client-side (3 minutes server-side); fulfilled but unretrieved requests auto-delete within 24 hours
- **MITM Protection**: Only the client with the RSA private key can decrypt the response
- **Limited Attack Surface**: Short timeout window minimizes QR code interception risks

More information about the mobile login flow can be found in the [Architecture Documentation](https://docs.aliasvault.net/architecture/#6-login-with-mobile).
