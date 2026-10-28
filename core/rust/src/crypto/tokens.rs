//! String constants for algorithm, key type and encryption type fields, stored and sent to the server as-is.

/// AES-256-GCM: the algorithm every Account Key and personal VEK is encrypted with (VaultKeyAlgorithm).
pub const ALGORITHM_AES256_GCM: &str = "aes256-gcm";

/// RSA-OAEP with SHA-256: grants and delivery keys.
pub const ALGORITHM_RSA_OAEP_SHA256: &str = "rsa-oaep-sha256";

/// A manifest whose VEK is encrypted with the Account Key (the personal manifest).
pub const KEY_TYPE_ACCOUNT_KEY: &str = "account-key";

/// A manifest whose VEK reaches this account as an RSA-OAEP grant (a shared manifest).
pub const KEY_TYPE_GRANT_KEY: &str = "grant-key";

/// The `EncryptionType` of a verifier made from the unlock key itself (accounts created before 0.31.0).
pub const ENCRYPTION_TYPE_ARGON2ID: &str = "Argon2Id";

/// The `EncryptionType` of a verifier made from the HKDF-derived SRP input: every new account and password change (since 0.31.0).
pub const ENCRYPTION_TYPE_ARGON2ID_HKDF: &str = "Argon2IdHkdf";
