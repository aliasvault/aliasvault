//-----------------------------------------------------------------------
// <copyright file="EmailClaimTransferRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Moves an email alias from its current owning manifest to another manifest.
/// </summary>
public class EmailClaimTransferRequest
{
    /// <summary>Gets or sets the full email address of the alias.</summary>
    public required string Address { get; set; }

    /// <summary>Gets or sets the manifest that becomes the new owner of the alias.</summary>
    public required Guid TargetManifestId { get; set; }
}
