//-----------------------------------------------------------------------
// <copyright file="StorageStatisticsResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Exact server-side storage of every manifest the caller can access.
/// </summary>
public class StorageStatisticsResponse
{
    /// <summary>Gets or sets the storage per accessible manifest.</summary>
    public List<ManifestStorageStatistics> Manifests { get; set; } = [];
}
