//-----------------------------------------------------------------------
// <copyright file="StorageFormat.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Storage format the server has recorded for the user's vault.
/// </summary>
public enum StorageFormat
{
    /// <summary>Legacy v1 (full encrypted SQLite blob).</summary>
    SqliteBlob = 0,

    /// <summary>Manifest-v1 (encrypted JSON manifest + separate metadata + content-addressed blobs).</summary>
    Manifest = 1,
}
