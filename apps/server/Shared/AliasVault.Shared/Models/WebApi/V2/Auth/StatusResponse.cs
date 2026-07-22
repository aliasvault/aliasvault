//-----------------------------------------------------------------------
// <copyright file="StatusResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Response model for the v2 status endpoint.
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
    /// Gets or sets the latest revision for each logical manifest the user has, so the client can compare each
    /// manifest's server revision against its own last-known revision per manifest. For a not-yet-migrated user
    /// the server synthesizes a Main entry from their legacy vault, so the list always contains at least one entry
    /// for an existing user.
    /// </summary>
    public List<ManifestRevision> ManifestRevisions { get; set; } = [];

    /// <summary>
    /// Gets or sets the SRP salt. This is used by the client to validate that the local encryption key
    /// still matches the latest vault revision. If it doesn't match, the client should trigger a logout
    /// to make the user re-authenticate with the new password.
    /// </summary>
    public required string SrpSalt { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the user has a vault key.
    /// </summary>
    public bool HasVaultKey { get; set; }
}
