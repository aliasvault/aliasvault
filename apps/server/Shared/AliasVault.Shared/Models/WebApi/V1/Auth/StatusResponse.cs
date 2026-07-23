//-----------------------------------------------------------------------
// <copyright file="StatusResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Auth;

/// <summary>
/// Response model for the v1 status endpoint.
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
    /// Gets or sets the latest vault revision number for the authenticated user, which the client
    /// can use to determine if it should refresh the vault from the server.
    /// </summary>
    public required long VaultRevision { get; set; }

    /// <summary>
    /// Gets or sets the SRP salt. This is used by the client to validate that the local encryption key
    /// still matches the latest vault revision. If it doesn't match, the client should trigger a logout
    /// to make the user re-authenticate with the new password.
    /// </summary>
    public required string SrpSalt { get; set; }
}
