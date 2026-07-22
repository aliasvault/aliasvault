//-----------------------------------------------------------------------
// <copyright file="CreateVaultKeyRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Vault key creation payload carried inside <see cref="UploadRequest"/> for the KEK/VEK migration.
/// TODO: remove this class once the legacy model is fully deprecated and upgrade path is no longer needed.
/// </summary>
public class CreateVaultKeyRequest
{
    /// <summary>Gets or sets the unlock method type. Only "password" is supported.</summary>
    public required string KeyType { get; set; }

    /// <summary>Gets or sets the wrapped VEK: base64(IV | ciphertext | authTag) of the newly generated VEK
    /// encrypted with the KEK using AES-256-GCM.</summary>
    public required string WrappedVek { get; set; }
}
