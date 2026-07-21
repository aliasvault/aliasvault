//-----------------------------------------------------------------------
// <copyright file="ManifestRevision.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// The current revision of a single logical manifest. Used in lightweight payloads (the status response) that report
/// per-manifest revisions without carrying the encrypted blobs. Mirrors <see cref="BucketRevision"/>.
/// </summary>
public class ManifestRevision
{
    /// <summary>Gets or sets the stable identifier of the logical manifest.</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets a value indicating whether this is the user's root manifest.</summary>
    public required bool IsRoot { get; set; }

    /// <summary>Gets or sets the current (latest) revision number for this manifest.</summary>
    public required long Revision { get; set; }
}
