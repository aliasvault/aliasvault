//-----------------------------------------------------------------------
// <copyright file="ManifestWriteResult.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Per-manifest result of a <see cref="VaultWriteRequest"/>.
/// </summary>
public class ManifestWriteResult
{
    /// <summary>Gets or sets the manifest id.</summary>
    public Guid? ManifestId { get; set; }

    /// <summary>Gets or sets the revision.</summary>
    public required long Revision { get; set; }
}
