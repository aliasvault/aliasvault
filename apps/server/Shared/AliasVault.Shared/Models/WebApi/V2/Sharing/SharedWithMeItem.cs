//-----------------------------------------------------------------------
// <copyright file="SharedWithMeItem.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

/// <summary>
/// One shared folder the caller has been granted access to. The caller unwraps <see cref="WrappedVek"/> with the
/// private key matching the public key it was wrapped for, then uses the resulting VEK to decrypt the folder manifest.
/// </summary>
public class SharedWithMeItem
{
    /// <summary>Gets or sets the shared folder manifest id.</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the folder's display name.</summary>
    public string? Name { get; set; }

    /// <summary>Gets or sets the owner's user id.</summary>
    public required string OwnerUserId { get; set; }

    /// <summary>Gets or sets the owner's username.</summary>
    public string? OwnerUsername { get; set; }

    /// <summary>Gets or sets the folder VEK wrapped with the caller's public key (base64).</summary>
    public required string WrappedVek { get; set; }

    /// <summary>Gets or sets the wrap scheme of the grant (e.g. "x25519-sealedbox").</summary>
    public required string WrapScheme { get; set; }
}
