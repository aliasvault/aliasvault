//-----------------------------------------------------------------------
// <copyright file="AccountKeysUpload.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// Upload request for the encrypted Account Key and KEK derivation parameters for the given unlock method.
/// </summary>
public class AccountKeysUpload
{
    /// <summary>Gets or sets the Account Key encrypted with the KEK derived from the unlock method.</summary>
    public string? EncryptedAccountKey { get; set; }

    /// <summary>Gets or sets the encrypted VEK.</summary>
    public string? AccountPublicKey { get; set; }

    /// <summary>Gets or sets the account private key encrypted with the Account Key.</summary>
    public string? EncryptedAccountPrivateKey { get; set; }
}
