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
    public const int MaxEncryptedPrivateKeyLength = 4000;

    /// <summary>Gets or sets the Account Key encrypted with the KEK derived from the unlock method.</summary>
    public string? EncryptedAccountKey { get; set; }

    /// <summary>Gets or sets the vault encryption key encrypted with the Account Key, as base64(IV | ciphertext | authTag).</summary>
    public string? EncryptedVek { get; set; }

    /// <summary>Gets or sets the public half (JWK) of the account keypair, which others encrypt shared-manifest grants for this user with.</summary>
    public string? AccountPublicKey { get; set; }

    /// <summary>Gets or sets the account private key encrypted with the Account Key.</summary>
    public string? EncryptedAccountPrivateKey { get; set; }

    /// <summary>
    /// Gets a value indicating whether all four fields are present. A partial upload is not usable.
    /// </summary>
    public bool IsComplete => !string.IsNullOrEmpty(EncryptedAccountKey) && !string.IsNullOrEmpty(EncryptedVek) && !string.IsNullOrEmpty(AccountPublicKey) && !string.IsNullOrEmpty(EncryptedAccountPrivateKey);

    /// <summary>
    /// Gets a value indicating whether every field fits its storage column, so an oversized value is a validation error instead of a database exception.
    /// </summary>
    public bool FitsStorageLimits => (EncryptedAccountKey?.Length ?? 0) <= MaxWrappedKeyLength && (EncryptedVek?.Length ?? 0) <= MaxWrappedKeyLength && (AccountPublicKey?.Length ?? 0) <= MaxPublicKeyLength && (EncryptedAccountPrivateKey?.Length ?? 0) <= MaxEncryptedPrivateKeyLength;
}
