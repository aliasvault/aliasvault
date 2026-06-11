//-----------------------------------------------------------------------
// <copyright file="VaultManifestCategory.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using System.Text.Json.Serialization;

/// <summary>
/// The category of a vault manifest. A user's logical vault is assembled from one or more manifests: exactly one
/// <see cref="Main"/> manifest plus (from R2) any number of <see cref="SharedFolder"/> manifests they own or have
/// been granted access to. Serialized as its string name on the wire and stored as a string in the database.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum VaultManifestCategory
{
    /// <summary>The user's own personal vault. Every user has exactly one. The only kind produced in R1.</summary>
    Main = 0,

    /// <summary>A shared folder manifest, owned by one user and shared with others via wrapped keys (R2).</summary>
    SharedFolder = 1,
}
