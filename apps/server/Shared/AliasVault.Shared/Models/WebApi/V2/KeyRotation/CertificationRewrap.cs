//-----------------------------------------------------------------------
// <copyright file="CertificationRewrap.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.KeyRotation;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// A key certification the caller made, signed again with the new signing key.
/// </summary>
public class CertificationRewrap
{
    /// <summary>
    /// Gets or sets the user whose key was certified.
    /// </summary>
    public required string SubjectUserId { get; set; }

    /// <summary>
    /// Gets or sets the certified signing public key (base64), as stored.
    /// </summary>
    public required string SubjectSigningPublicKey { get; set; }

    /// <summary>
    /// Gets or sets the caller's signature over the key certification message, made with the new signing key.
    /// </summary>
    [StringLength(255)]
    public required string Signature { get; set; }
}
