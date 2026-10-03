# ARCHITECTURE.md
This document provides a high-level overview of the AliasVault architecture, focusing on the encryption algorithms used to ensure the security of user data.

## Overview
AliasVault implements zero-knowledge encryption using a combination of encryption algorithms to protect the privacy of its users.

The basic premise is that the master password chosen by the user upon registration is the entry point to all encryption and decryption operations. This master password is never transmitted over the network and only resides on the client.

The master password does not encrypt the vault directly. It unlocks a small hierarchy of random keys (see [Key hierarchy](#key-hierarchy)), which allows the master password to be changed without encrypting the vault again, and allows a vault to be shared with other users without ever sharing a password.

### What is Zero-Knowledge Encrypted
- **Vault Data**: Your entire vault (passwords, usernames, notes, passkeys, attachments, email addresses, etc.) is fully encrypted client-side before being sent to the server. The server cannot decrypt any vault contents.
- **Email Contents**: When emails are received by the server, their contents are immediately encrypted with the public key of the vault the email alias belongs to before being saved. Only users with access to that vault can decrypt and read these emails.
- **Shared Vaults**: Vaults shared with other users are encrypted with their own key, which is handed to each member encrypted with that member's public key. The server never sees a shared vault key in plaintext.

This ensures that even if the AliasVault servers are compromised, vault contents and email messages remain secure and unreadable.

## Encryption algorithms
The following encryption algorithms and standards are used by AliasVault:

### Core Vault Encryption
- [Argon2id](#argon2id) - Key derivation from master password
- [SRP](#srp) - Secure authentication protocol
- [Key hierarchy](#key-hierarchy) - KEK, Account Key and Vault Encryption Key
- [AES-GCM](#aes-256-gcm) - Vault data encryption

### Additional Features
- [RSA-OAEP](#rsa-oaep) - Email encryption and vault sharing
- [Vault sharing](#vault-sharing) - Sharing a vault with other users
- [Passkeys (WebAuthn)](#passkeys-webauthn) - Passwordless authentication
- [Login with Mobile](#login-with-mobile) - Unlock vault in web app / browser extension via mobile app

Below is a detailed explanation of each encryption algorithm and standard.

For more information about how these algorithms are specifically used in AliasVault, see the [Architecture Documentation](https://docs.aliasvault.com/architecture) section on the documentation site.

### Argon2id
To derive a key from the master password, AliasVault uses the Argon2id key derivation function. The derived key is the
Key Encryption Key (KEK), see [Key hierarchy](#key-hierarchy). Argon2id is a memory-hard
key derivation function which allows for controlling the execution time, memory required and degree of parallelism.
This makes it resilient against brute-force attacks and makes it one of the best choices for deriving keys from passwords.

AliasVault uses Argon2id with the following default parameters for new accounts and password changes:
- Degree of parallelism: 1
- Memory size: 65536 KiB (64 MiB)
- Iterations: 5

This is well above the [OWASP minimum](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
(19 MiB, 2 iterations) and above the 64 MiB, 3 iterations of [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html#section-4).

More information about Argon2id can be found on the [Argon2](https://en.wikipedia.org/wiki/Argon2) Wikipedia page.

### SRP
The Secure Remote Password (SRP) protocol is used for authenticating a user with the AliasVault server during login.
The SRP protocol is a password-authenticated key exchange protocol (PAKE). This means that the client and server can
authenticate each other using a password, without sending the password itself over the network.

With the use of SRP the master password never leaves the client. The client sends a verifier to the server,
which is a value derived from the master password. The server uses this verifier to authenticate the client without
having ever seen the actual master password.

For more information see the [SRP protocol](https://en.wikipedia.org/wiki/Secure_Remote_Password_protocol) information on Wikipedia.

### Key hierarchy
The master password is not used to encrypt the vault itself. Instead, AliasVault uses three layers of keys:

1. **Key Encryption Key (KEK)**: derived from the master password with Argon2id. It is never stored on the server and only encrypts the Account Key.
2. **Account Key (AK)**: a random 256-bit key created on the client at registration. It encrypts the Vault Encryption Key and the account's RSA private key.
3. **Vault Encryption Key (VEK)**: a random 256-bit key that encrypts the vault contents. Every vault (the personal vault and every shared vault) has its own VEK.

```
master password --Argon2id--> KEK
KEK  --AES-256-GCM--> Account Key
Account Key --AES-256-GCM--> personal vault VEK
Account Key --AES-256-GCM--> account RSA private key
account RSA public key --RSA-OAEP--> shared vault VEK (one per shared vault)
VEK  --AES-256-GCM--> vault contents
```

The server stores only the encrypted forms: the Account Key encrypted with the KEK (one row per unlock method), the
personal VEK encrypted with the Account Key, the account keypair (public key in plaintext, private key encrypted with
the Account Key), and per shared vault the VEK encrypted with the user's public key.

This hierarchy has the following properties:
- **Password change**: changing the master password only encrypts the Account Key again under the new KEK. The vault, its attachments and any shared vault access stay untouched, so no vault data has to be re-encrypted or uploaded.
- **Unlock methods**: biometric unlock, PIN unlock and Login with Mobile all hold the KEK (protected by the device keychain, a PIN-derived key or a one-time RSA key). Every unlock walks the same chain, so the personal VEK and the account private key always become available together.
- **Additional unlock methods**: every unlock method encrypts the same Account Key, so a future method (e.g. a hardware key) can be added without re-encrypting anything else.

### AES-256-GCM
All user's vault data is fully encrypted on the client using the AES-256-GCM encryption algorithm, which stands for
*Advanced Encryption Standard with 256-bit key in Galois/Counter Mode*. The key for vault encryption is the vault's
random VEK (see [Key hierarchy](#key-hierarchy)), and AES-GCM is also used to encrypt the keys in the hierarchy
themselves. AliasVault implements AES-GCM with the following specifications:

- Key Size: 256 bits
- Implemented in the shared Rust core, which runs as WebAssembly in the browser extension and web app and as native bindings on iOS and Android
- Generates a random 12-byte (96-bit) IV (initialization vector) for each encryption operation
- Performs all encryption/decryption operations entirely on the client

#### The encryption process works as follows:
- A unique IV is generated for each encryption operation
- A user has access to one or more vaults: their personal vault plus every shared vault they are a member of. Each vault is stored on the server as a separate encrypted *manifest* (the technical term used in the code and API; the apps show it as a vault). Each manifest is compressed and then encrypted with the VEK of its vault
- Attachments and logos are stored as separate blobs. Every blob is encrypted with its own random 256-bit blob key, and the blob key is encrypted with the VEK of the vault it belongs to
- The IV is prepended to the ciphertext

More information about AES-GCM can be found on the [AES-GCM](https://en.wikipedia.org/wiki/Galois/Counter_Mode) Wikipedia page.

### RSA-OAEP
AliasVault uses RSA-OAEP (RSA with Optimal Asymmetric Encryption Padding) wherever data has to be encrypted for someone
without knowing their secret key. This asymmetric encryption system allows AliasVault to store emails on the server in
encrypted state which can only be read by the intended recipient, and to hand a shared vault's VEK to another user.
AliasVault implements RSA-OAEP with the following specifications:
- Algorithm: RSA-OAEP with SHA-256 hash
- Key Size: 2048-bit modulus
- Key Format: JWK (JSON Web Key)
- Padding: OAEP (Optimal Asymmetric Encryption Padding)

Two kinds of RSA key pairs are used, each for one purpose only:
- **Account keypair**: one per user, created at registration. The private key is encrypted with the Account Key, the public key is stored on the server. It is only used to receive shared vault keys (see [Vault sharing](#vault-sharing)).
- **Delivery keypair**: one per vault (personal or shared). The private key is stored inside that vault, the public key is published to the server for that vault. It is only used to encrypt emails for the aliases in that vault.

#### Email Security Flow
1. Key Generation: When a vault is created, a delivery RSA key pair is generated for it:
   - A private key that remains in that encrypted vault and is never transmitted
   - A public key that is sent to the server together with the vault
   - When a member loses access to a shared vault, its delivery key pair is replaced by a new one, so future email is no longer readable with the old private key

2. Email Reception Process: When an email arrives at the AliasVault email server:
   - The server looks up every vault the email alias is linked to (normally one, more when the alias is used in multiple vaults)
   - The server generates a random 256-bit symmetric encryption key to encrypt the email contents
   - The symmetric encryption key is encrypted once for the delivery public key of each of these vaults
   - The encrypted email contents together with the encrypted symmetric encryption key(s) are stored in the server's database
   - The original email content is never stored or logged

3. Email Retrieval Process:
   - When a user accesses their emails, the encrypted content is retrieved from the server, along with the encrypted symmetric keys for the vaults the user has access to
   - The client-side application decrypts the symmetric encryption key using the delivery private key stored in the matching vault
   - The decrypted symmetric encryption key is used to decrypt the email contents
   - Decryption occurs entirely on the client, maintaining end-to-end encryption

This implementation ensures that:
- Emails are encrypted and secure at rest in the server database
- Only users that have access to the vault holding the private key can decrypt and read the emails
- Even if the server is compromised, email contents remain encrypted and unreadable

More information about RSA-OAEP can be found on the [RSA-OAEP](https://en.wikipedia.org/wiki/Optimal_asymmetric_encryption_padding) Wikipedia page.

### Vault sharing
AliasVault allows a vault to be shared with other users, for example within a family. Every shared vault is a separate
manifest (see [AES-256-GCM](#aes-256-gcm)) with its own random VEK, so sharing never exposes the personal vault or the master password of anyone involved.

#### Implementation Details
1. **Creation**: a group admin creates the shared vault on their client. The client generates a new VEK and a delivery keypair for it, and stores the VEK encrypted with the admin's own account public key. The vault name is encrypted with the VEK.

2. **Invitation**: to invite a user, the admin's client fetches the invitee's account public key from the server and encrypts the shared VEK (and the vault name) with it. The server stores this encrypted copy with the invitation.

3. **Acceptance**: when the invitee accepts, the encrypted VEK becomes their access key for that vault. On their next sync, their client decrypts the VEK with their account private key and can read and write the shared vault.

4. **Revocation**: removing a member deletes their access key on the server, and the server asks an admin's client to replace the vault's delivery keypair so new email is no longer encrypted to a key the removed member has seen.

#### Security Properties
- **Zero-Knowledge**: the server only stores shared VEKs encrypted with each member's public key and never sees them in plaintext
- **Access is per user**: a group itself holds no keys; only users that received an encrypted VEK can open a shared vault, regardless of their role in the group
- **Separated keys**: the account keypair is only used for receiving vault keys, the delivery keypairs only for email, so a key stored in a vault only ever unlocks that vault's own content

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

1. **Initiation**: Browser/extension client generates an RSA-2048 key pair locally and sends the public key to the server, which returns a unique request ID and a poll secret. The QR code contains the request ID and a SHA-256 hash of the public key.

2. **Authorization**: Mobile app scans the QR code and checks that the public key on the server matches the hash in the QR code. The requesting screen shows a 2-digit verification code derived from the public key; the user picks the same code on the phone out of four options, approves, and confirms with biometrics or PIN. The mobile app then encrypts the user's KEK with the RSA public key and sends it to the server.

3. **Retrieval**: Browser client polls the server with its poll secret. When ready, the server:
   - Generates fresh JWT tokens for the session
   - Creates a random AES-256 symmetric key
   - Encrypts tokens and username with the symmetric key
   - Encrypts the symmetric key with the client's RSA public key
   - Returns encrypted data and immediately purges it from the database

4. **Decryption**: Client uses its RSA private key to decrypt the symmetric key, then uses the symmetric key to decrypt tokens and username, and the RSA private key to decrypt the KEK. The KEK unlocks the Account Key, the VEK and the account private key, as with a password login.

#### Security Properties
- **Zero-Knowledge**: Server never accesses the KEK in plaintext
- **Request Binding**: The QR code and verification code are bound to the requesting client's public key, so a request initiated by someone else cannot be approved by accident
- **One-Time Use**: Requests cannot be retrieved twice; data is immediately cleared after retrieval, and only the client holding the poll secret can retrieve it
- **Automatic Expiration**: Requests must be approved within 3 minutes and retrieved within 1 minute after approval; expired requests are cleaned up by the server
- **MITM Protection**: Only the client with the RSA private key can decrypt the response
- **Limited Attack Surface**: Short timeout window minimizes QR code interception risks

More information about the mobile login flow can be found in the [Architecture Documentation](https://docs.aliasvault.com/architecture/#6-login-with-mobile).
