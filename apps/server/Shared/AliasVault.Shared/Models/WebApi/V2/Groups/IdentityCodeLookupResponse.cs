//-----------------------------------------------------------------------
// <copyright file="IdentityCodeLookupResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// The account an identity code belongs to. The client checks <see cref="SigningPublicKey"/> against the code itself.
/// </summary>
public class IdentityCodeLookupResponse
{
    /// <summary>Gets or sets the account's user id.</summary>
    public required string UserId { get; set; }

    /// <summary>Gets or sets the account's username.</summary>
    public required string Username { get; set; }

    /// <summary>Gets or sets the account's signing public key (base64), whose fingerprint is the code.</summary>
    public required string SigningPublicKey { get; set; }

    /// <summary>Gets or sets the id of the account public key a vault key is encrypted for them with, if they have one.</summary>
    public Guid? AccountPublicKeyId { get; set; }

    /// <summary>Gets or sets that account public key (JWK), if they have one.</summary>
    public string? AccountPublicKey { get; set; }

    /// <summary>Gets or sets the signature of the account public key by the signing key.</summary>
    public string? AccountPublicKeySignature { get; set; }
}
