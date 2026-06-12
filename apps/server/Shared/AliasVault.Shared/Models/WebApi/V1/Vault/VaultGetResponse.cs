//-----------------------------------------------------------------------
// <copyright file="VaultGetResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Vault;

using AliasVault.Shared.Models.Enums;

/// <summary>
/// Vault get response model.
/// </summary>
public class VaultGetResponse
{
    /// <summary>
    /// Gets or sets the status of the vault get operation.
    /// </summary>
    public VaultStatus Status { get; set; }

    /// <summary>
    /// Gets or sets the requested vault.
    /// </summary>
    public Vault? Vault { get; set; }
}
