//-----------------------------------------------------------------------
// <copyright file="GrantRewrap.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.KeyRotation;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// One shared-vault grant the caller holds, encrypted for the new account public key and signed by the caller.
/// </summary>
public class GrantRewrap
{
    /// <summary>
    /// Gets or sets the shared manifest.
    /// </summary>
    public required Guid ManifestId { get; set; }

    /// <summary>
    /// Gets or sets the VEK generation the grant yields; the manifest's current one.
    /// </summary>
    public int KeyVersion { get; set; }

    /// <summary>
    /// Gets or sets the manifest's VEK encrypted for the new account public key.
    /// </summary>
    public required string EncryptedVek { get; set; }

    /// <summary>
    /// Gets or sets the algorithm token of the encryption.
    /// </summary>
    public required string Algorithm { get; set; }

    /// <summary>
    /// Gets or sets the caller's signature over the grant, made with the new signing key.
    /// </summary>
    [StringLength(255)]
    public required string Signature { get; set; }
}
