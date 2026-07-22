//-----------------------------------------------------------------------
// <copyright file="VaultKeyResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

/// <summary>
/// Response for GET /v2/VaultKey/{keyType}.
/// </summary>
public class VaultKeyResponse
{
    /// <summary>Gets or sets the unlock method type.</summary>
    public required string KeyType { get; set; }

    /// <summary>Gets or sets the wrapped VEK: base64(IV | ciphertext | authTag) of the VEK encrypted with the KEK.</summary>
    public required string WrappedVek { get; set; }

    /// <summary>Gets or sets the salt used for KEK derivation.</summary>
    public required string Salt { get; set; }

    /// <summary>Gets or sets the key derivation type.</summary>
    public required string EncryptionType { get; set; }

    /// <summary>Gets or sets the key derivation settings.</summary>
    public required string EncryptionSettings { get; set; }
}
