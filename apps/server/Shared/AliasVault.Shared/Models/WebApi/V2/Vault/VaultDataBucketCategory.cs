//-----------------------------------------------------------------------
// <copyright file="VaultDataBucketCategory.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using System.Text.Json.Serialization;

/// <summary>
/// Known data-bucket categories for the manifest-v1 storage format. Each value is one small, independently-versioned,
/// user-scoped category of encrypted data kept out of the main vault content manifest so it syncs cheaply.
/// Serialized as its string name on the wire (not the numeric value) and stored as a string in the database.
/// Adding a new kind requires a server-side rollout first, because the server reasons about kinds for
/// per-kind retention policies.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum VaultDataBucketCategory
{
    /// <summary>User client settings (sort order, autofill prefs, identity defaults, etc.).</summary>
    Settings = 0,
}
