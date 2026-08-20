//-----------------------------------------------------------------------
// <copyright file="GrantRecipient.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// A user a shared manifest's VEK can be encrypted for, with the public key to encrypt it with.
/// </summary>
public class GrantRecipient
{
    /// <summary>Gets or sets the user id.</summary>
    public required string UserId { get; set; }

    /// <summary>Gets or sets the id of the user's primary public key.</summary>
    public required Guid PublicKeyId { get; set; }

    /// <summary>Gets or sets the public key itself (JWK).</summary>
    public required string PublicKey { get; set; }
}
