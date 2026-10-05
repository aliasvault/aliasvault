//-----------------------------------------------------------------------
// <copyright file="VaultWriteStatus.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using System.Text.Json.Serialization;

/// <summary>
/// Outcome of a POST /v2/Vault write.
/// </summary>
[JsonConverter(typeof(KebabCaseEnumConverter))]
public enum VaultWriteStatus
{
    /// <summary>The write was accepted.</summary>
    Ok,

    /// <summary>A manifest, bucket or email routing revision is stale; the client pulls, merges and retries.</summary>
    Outdated,
}
