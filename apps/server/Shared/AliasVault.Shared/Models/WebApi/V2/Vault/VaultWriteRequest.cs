//-----------------------------------------------------------------------
// <copyright file="VaultWriteRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using System.Text.Json.Serialization;

/// <summary>
/// Unified atomic write for POST /v2/Vault.
/// </summary>
public class VaultWriteRequest
{
    /// <summary>Gets or sets the username.</summary>
    public required string Username { get; set; }

    /// <summary>Gets or sets the manifests to write.</summary>
    public List<ManifestWrite> Manifests { get; set; } = [];

    /// <summary>Gets or sets the data buckets to upsert.</summary>
    public List<BucketWrite> Buckets { get; set; } = [];

    /// <summary>Gets or sets the email routing data to update server-side.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public EmailRoutingPush? EmailRouting { get; set; }

    /// <summary>Gets or sets the one-time migrations to apply atomically with this write.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public VaultWriteMigration? Migration { get; set; }
}
