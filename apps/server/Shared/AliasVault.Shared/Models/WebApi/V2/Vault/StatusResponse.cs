//-----------------------------------------------------------------------
// <copyright file="StatusResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Response for GET /v2/Vault/status. Tells the client whether to migrate or run the v2 flow.
/// </summary>
public class StatusResponse
{
    /// <summary>Gets or sets the storage format the server has recorded for the user's latest vault.</summary>
    public required StorageFormat StorageFormat { get; set; }

    /// <summary>Gets or sets the latest revision for each logical manifest the user has. Empty for legacy users.</summary>
    public List<ManifestRevision> ManifestRevisions { get; set; } = [];

    /// <summary>Gets or sets the latest revision for each data-bucket kind the user has. Empty when none stored.</summary>
    public List<BucketRevision> BucketRevisions { get; set; } = [];

    /// <summary>Gets or sets a value indicating whether the user has a vault key (KEK/VEK model). When false the
    /// client must perform the KEK/VEK migration on its next full vault upload via <see cref="UploadRequest.CreateVaultKey"/>.</summary>
    public bool HasVaultKey { get; set; }
}
