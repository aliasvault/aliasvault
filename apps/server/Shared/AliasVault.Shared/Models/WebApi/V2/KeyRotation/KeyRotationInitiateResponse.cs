//-----------------------------------------------------------------------
// <copyright file="KeyRotationInitiateResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.KeyRotation;

/// <summary>
/// Server answer to GET /v2/KeyRotation/initiate: the SRP handshake material for the current password and the
/// key generations the rotation has to name as its starting point.
/// </summary>
public class KeyRotationInitiateResponse
{
    /// <summary>
    /// Gets or sets the salt of the current password.
    /// </summary>
    public required string Salt { get; set; }

    /// <summary>
    /// Gets or sets the server SRP ephemeral.
    /// </summary>
    public required string ServerEphemeral { get; set; }

    /// <summary>
    /// Gets or sets the KDF type of the current password.
    /// </summary>
    public required string EncryptionType { get; set; }

    /// <summary>
    /// Gets or sets the KDF settings of the current password.
    /// </summary>
    public required string EncryptionSettings { get; set; }

    /// <summary>
    /// Gets or sets the SRP identity.
    /// </summary>
    public required string SrpIdentity { get; set; }

    /// <summary>
    /// Gets or sets the caller's user id, which the caller's own grant signatures name as the signer.
    /// </summary>
    public required string UserId { get; set; }

    /// <summary>
    /// Gets or sets the current Account Key generation.
    /// </summary>
    public int AccountKeyVersion { get; set; }

    /// <summary>
    /// Gets or sets the personal manifest id.
    /// </summary>
    public Guid PersonalManifestId { get; set; }

    /// <summary>
    /// Gets or sets the current key generation of the personal manifest's VEK.
    /// </summary>
    public int ManifestKeyVersion { get; set; }
}
