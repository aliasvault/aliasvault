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

    /// <summary>
    /// Gets or sets a value indicating whether the user switched this alias off for this manifest. A client pushes
    /// every alias it carries, paused ones included: absence from the push means the alias is gone from the vault,
    /// while <c>true</c> means the user switched it off and its stored mail must be kept. Defaults to false.
    /// </summary>
    public bool Paused { get; set; }
}
