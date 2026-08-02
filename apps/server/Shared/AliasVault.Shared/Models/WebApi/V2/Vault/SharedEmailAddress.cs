//-----------------------------------------------------------------------
// <copyright file="SharedEmailAddress.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// An email alias whose item lives in a shared manifest: mail for it is encrypted with the manifest's
/// published keypair rather than the routing owner's personal key, so every member of the folder can
/// read it.
/// </summary>
public class SharedEmailAddress
{
    /// <summary>Gets or sets the full email address.</summary>
    public required string Address { get; set; }

    /// <summary>Gets or sets the shared manifest whose key encrypts mail for this address.</summary>
    public required Guid ManifestId { get; set; }
}
