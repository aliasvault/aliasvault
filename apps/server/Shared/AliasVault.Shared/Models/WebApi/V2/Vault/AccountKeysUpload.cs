//-----------------------------------------------------------------------
// <copyright file="AccountKeysUpload.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Model which contains the account key hierarchy to be uploaded to the manifest-v1 format. Used in both new account creation
/// and the "sqlite-blob to manifest-v1" one-time migration for older accounts.
/// </summary>
public class AccountKeysUpload
{
    /// <summary>Maximum accepted length of <see cref="EncryptedAccountKey"/> and <see cref="EncryptedVek"/>.</summary>
    public const int MaxWrappedKeyLength = 255;

    /// <summary>Maximum accepted length of <see cref="AccountPublicKey"/>.</summary>
    public const int MaxPublicKeyLength = 2000;

    /// <summary>Maximum accepted length of <see cref="EncryptedAccountPrivateKey"/>.</summary>
    public const int MaxEncryptedPrivateKeyLength = 8000;

    /// <summary>Maximum accepted length of <see cref="SigningPublicKey"/>.</summary>
    public const int MaxSigningPublicKeyLength = 100;

    /// <summary>Maximum accepted length of <see cref="EncryptedSigningPrivateKey"/> and <see cref="AccountPublicKeySignature"/>.</summary>
    public const int MaxSigningValueLength = 255;

    /// <summary>Gets or sets the Account Key encrypted with the KEK derived from the unlock method.</summary>
    public string? EncryptedAccountKey { get; set; }

    /// <summary>Gets or sets the algorithm of <see cref="EncryptedAccountKey"/>, as a VaultKeyAlgorithm token.</summary>
    public string? EncryptedAccountKeyAlgorithm { get; set; }

    /// <summary>Gets or sets the vault encryption key encrypted with the Account Key, as base64(IV | ciphertext | authTag).</summary>
    public string? EncryptedVek { get; set; }

    /// <summary>Gets or sets the public half (JWK) of the account keypair, which others encrypt shared-manifest grants for this user with.</summary>
    public string? AccountPublicKey { get; set; }

    /// <summary>Gets or sets the account private key encrypted with the Account Key.</summary>
    public string? EncryptedAccountPrivateKey { get; set; }

    /// <summary>Gets or sets the public half (base64) of the account signing keypair.</summary>
    public string? SigningPublicKey { get; set; }

    /// <summary>Gets or sets the account signing private key encrypted with the Account Key.</summary>
    public string? EncryptedSigningPrivateKey { get; set; }

    /// <summary>Gets or sets the signing key's signature over <see cref="AccountPublicKey"/>.</summary>
    public string? AccountPublicKeySignature { get; set; }

    /// <summary>
    /// Gets a value indicating whether every field is present. A partial upload is not usable.
    /// </summary>
    public bool IsComplete => !string.IsNullOrEmpty(EncryptedAccountKey) && !string.IsNullOrEmpty(EncryptedAccountKeyAlgorithm) && !string.IsNullOrEmpty(EncryptedVek) && !string.IsNullOrEmpty(AccountPublicKey) && !string.IsNullOrEmpty(EncryptedAccountPrivateKey)
        && !string.IsNullOrEmpty(SigningPublicKey) && !string.IsNullOrEmpty(EncryptedSigningPrivateKey) && !string.IsNullOrEmpty(AccountPublicKeySignature);

    /// <summary>
    /// Gets a value indicating whether every field fits its storage column, so an oversized value is a validation error instead of a database exception.
    /// </summary>
    public bool FitsStorageLimits => (EncryptedAccountKey?.Length ?? 0) <= MaxWrappedKeyLength && (EncryptedVek?.Length ?? 0) <= MaxWrappedKeyLength && (AccountPublicKey?.Length ?? 0) <= MaxPublicKeyLength && (EncryptedAccountPrivateKey?.Length ?? 0) <= MaxEncryptedPrivateKeyLength
        && (SigningPublicKey?.Length ?? 0) <= MaxSigningPublicKeyLength && (EncryptedSigningPrivateKey?.Length ?? 0) <= MaxSigningValueLength && (AccountPublicKeySignature?.Length ?? 0) <= MaxSigningValueLength;
}
