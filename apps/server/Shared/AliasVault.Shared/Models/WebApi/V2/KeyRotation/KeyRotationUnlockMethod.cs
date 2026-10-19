//-----------------------------------------------------------------------
// <copyright file="KeyRotationUnlockMethod.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.KeyRotation;

/// <summary>
/// The master-password unlock method after the rotation: a new salt and verifier, with the new or the same password.
/// </summary>
public class KeyRotationUnlockMethod
{
    /// <summary>
    /// Gets or sets the new password salt.
    /// </summary>
    public required string Salt { get; set; }

    /// <summary>
    /// Gets or sets the new SRP verifier.
    /// </summary>
    public required string Verifier { get; set; }

    /// <summary>
    /// Gets or sets the KDF type.
    /// </summary>
    public required string EncryptionType { get; set; }

    /// <summary>
    /// Gets or sets the KDF settings JSON.
    /// </summary>
    public required string EncryptionSettings { get; set; }

    /// <summary>
    /// Gets or sets the new Account Key encrypted with the new KEK.
    /// </summary>
    public required string EncryptedAccountKey { get; set; }

    /// <summary>
    /// Gets or sets the algorithm token of <see cref="EncryptedAccountKey"/>.
    /// </summary>
    public required string EncryptedAccountKeyAlgorithm { get; set; }
}
