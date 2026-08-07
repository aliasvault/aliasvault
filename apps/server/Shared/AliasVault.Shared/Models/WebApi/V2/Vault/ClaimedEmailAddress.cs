//-----------------------------------------------------------------------
// <copyright file="ClaimedEmailAddress.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// An email alias the client claims, together with the manifest holding the item it belongs to. The manifest
/// decides how the alias's mail is encrypted: a shared manifest's published keypair (readable by every member)
/// or, for the caller's personal manifest, their own primary personal key.
/// </summary>
public class ClaimedEmailAddress
{
    /// <summary>Gets or sets the full email address.</summary>
    public required string Address { get; set; }

    /// <summary>Gets or sets the manifest whose key encrypts mail for this address.</summary>
    public required Guid ManifestId { get; set; }
}
