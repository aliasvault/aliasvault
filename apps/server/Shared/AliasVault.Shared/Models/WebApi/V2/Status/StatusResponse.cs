//-----------------------------------------------------------------------
// <copyright file="StatusResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Status;

using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Response for GET /v2/Status: a single generic status endpoint that combines session/version checks
/// with the vault storage-format and revision info.
/// </summary>
public class StatusResponse
{
    /// <summary>
    /// Gets or sets a value indicating whether the client version is supported by this API, as
    /// determined by the server based on the client provided header.
    /// </summary>
    public required bool ClientVersionSupported { get; set; }

    /// <summary>
    /// Gets or sets the API version of the server. This is used by the client to determine if it
    /// is compatible with the server or if the server should be updated to a newer version.
    /// </summary>
    public required string ServerVersion { get; set; }

    /// <summary>
    /// Gets or sets the SRP salt. This is used by the client to validate that the local encryption key
    /// still matches the latest vault revision. If it doesn't match, the client should trigger a logout
    /// to make the user re-authenticate with the new password.
    /// </summary>
    public required string SrpSalt { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the user has a vault key (KEK/VEK model).
    /// TODO: remove once every user has migrated to the KEK/VEK model.
    /// </summary>
    public bool HasVaultKey { get; set; }

    /// <summary>Gets or sets the storage format the server has recorded for the user's latest vault.</summary>
    public required StorageFormat StorageFormat { get; set; }

    /// <summary>
    /// Gets or sets the latest revision for each logical manifest the user has access to.
    /// </summary>
    public List<ManifestRevision> ManifestRevisions { get; set; } = [];

    /// <summary>Gets or sets the latest revision for each data-bucket kind the user has. Empty when none stored.</summary>
    public List<BucketRevision> BucketRevisions { get; set; } = [];
}
