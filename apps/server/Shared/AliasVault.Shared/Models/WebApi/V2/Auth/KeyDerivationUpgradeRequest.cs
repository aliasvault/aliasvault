//-----------------------------------------------------------------------
// <copyright file="KeyDerivationUpgradeRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

/// <summary>
/// Request for POST /v2/Auth/key-derivation-upgrade: the same password and salt under stronger key derivation settings.
/// </summary>
public class KeyDerivationUpgradeRequest
{
    /// <summary>
    /// Gets or sets the client's public ephemeral for the SRP proof of the current password.
    /// </summary>
    public required string CurrentClientPublicEphemeral { get; set; }

    /// <summary>
    /// Gets or sets the client's session proof for the SRP proof of the current password.
    /// </summary>
    public required string CurrentClientSessionProof { get; set; }

    /// <summary>
    /// Gets or sets the SRP verifier derived under the new settings.
    /// </summary>
    public required string NewPasswordVerifier { get; set; }

    /// <summary>
    /// Gets or sets the Account Key encrypted with the KEK derived under the new settings.
    /// </summary>
    public required string NewEncryptedAccountKey { get; set; }

    /// <summary>
    /// Gets or sets the algorithm of <see cref="NewEncryptedAccountKey"/>, as a VaultKeyAlgorithm token.
    /// </summary>
    public required string NewEncryptedAccountKeyAlgorithm { get; set; }

    /// <summary>
    /// Gets or sets the KDF type the client derived the new unlock key with.
    /// </summary>
    public required string NewEncryptionType { get; set; }

    /// <summary>
    /// Gets or sets the KDF settings JSON the client derived the new unlock key with.
    /// </summary>
    public required string NewEncryptionSettings { get; set; }
}
