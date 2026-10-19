//-----------------------------------------------------------------------
// <copyright file="KeyRotationAccountKeys.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.KeyRotation;

using System.Text.Json.Serialization;
using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// The new account keys, every private half encrypted with the new Account Key.
/// </summary>
public class KeyRotationAccountKeys
{
    /// <summary>
    /// Gets or sets the new VEK encrypted with the new Account Key.
    /// </summary>
    public required string EncryptedVek { get; set; }

    /// <summary>
    /// Gets or sets the new account encryption public key (JWK).
    /// </summary>
    public required string AccountPublicKey { get; set; }

    /// <summary>
    /// Gets or sets the new account encryption private key encrypted with the new Account Key.
    /// </summary>
    public required string EncryptedAccountPrivateKey { get; set; }

    /// <summary>
    /// Gets or sets the new signing key's signature over <see cref="AccountPublicKey"/>.
    /// </summary>
    public required string AccountPublicKeySignature { get; set; }

    /// <summary>
    /// Gets or sets the new signing public key.
    /// </summary>
    public required string SigningPublicKey { get; set; }

    /// <summary>
    /// Gets or sets the new signing private key encrypted with the new Account Key.
    /// </summary>
    public required string EncryptedSigningPrivateKey { get; set; }

    /// <summary>
    /// Gets or sets the previous signing key's signature over the new signing public key.
    /// </summary>
    public required string PreviousSigningKeySignature { get; set; }

    /// <summary>
    /// Gets a value indicating whether every value is present and within the stored size limits.
    /// </summary>
    [JsonIgnore]
    public bool FitsStorageLimits => EncryptedVek.Length <= AccountKeysUpload.MaxWrappedKeyLength && AccountPublicKey.Length <= AccountKeysUpload.MaxPublicKeyLength
        && EncryptedAccountPrivateKey.Length <= AccountKeysUpload.MaxEncryptedPrivateKeyLength && AccountPublicKeySignature.Length <= AccountKeysUpload.MaxSigningValueLength && SigningPublicKey.Length <= AccountKeysUpload.MaxSigningPublicKeyLength
        && EncryptedSigningPrivateKey.Length <= AccountKeysUpload.MaxSigningValueLength && PreviousSigningKeySignature.Length <= AccountKeysUpload.MaxSigningValueLength;
}
