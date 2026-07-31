//-----------------------------------------------------------------------
// <copyright file="RecipientLookupResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Sharing;

/// <summary>
/// Response for GET /v2/Sharing/recipient. Returns the primary public key a granter uses to encrypt a shared folder's
/// VEK for the recipient.
/// </summary>
public class RecipientLookupResponse
{
    /// <summary>Gets or sets the recipient's user id.</summary>
    public required string UserId { get; set; }

    /// <summary>Gets or sets the id of the recipient's primary public key (used as EncryptedVek's RecipientPublicKeyId).</summary>
    public required Guid PublicKeyId { get; set; }

    /// <summary>Gets or sets the recipient's primary public key (the granter encrypts the folder VEK with this).</summary>
    public required string PublicKey { get; set; }
}
