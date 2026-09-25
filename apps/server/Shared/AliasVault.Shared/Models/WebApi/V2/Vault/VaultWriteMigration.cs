//-----------------------------------------------------------------------
// <copyright file="VaultWriteMigration.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using System.Text.Json.Serialization;

/// <summary>
/// One-time migrations applied atomically with a vault write. Each migration is its own optional field.
/// </summary>
public class VaultWriteMigration
{
    /// <summary>
    /// Gets or sets the newly created account key hierarchy for a legacy vault's first manifest-v1 push (pre-0.31.0).
    /// TODO: remove once legacy accounts are no longer supported.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public AccountKeysUpload? AccountKeys { get; set; }
}
