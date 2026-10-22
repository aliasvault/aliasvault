//-----------------------------------------------------------------------
// <copyright file="AccountFingerprintLookupRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// Look up the account an account fingerprint belongs to (POST /v2/Groups/lookup).
/// </summary>
public class AccountFingerprintLookupRequest
{
    /// <summary>Gets or sets the account fingerprint the other person gave; separators are ignored.</summary>
    public required string Code { get; set; }
}
