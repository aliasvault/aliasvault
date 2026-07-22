//-----------------------------------------------------------------------
// <copyright file="VaultKeyGetResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

/// <summary>
/// Response for GET /v2/VaultKey/{keyType}.
/// </summary>
public class VaultKeyGetResponse
{
    /// <summary>Gets or sets the vault key, or null when the user has no vault key of the requested type (sqlite-blob legacy storage format).</summary>
    public VaultKeyResponse? VaultKey { get; set; }
}
