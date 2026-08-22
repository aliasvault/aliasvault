//-----------------------------------------------------------------------
// <copyright file="ReceivedManifestInvitation.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// An open offer of access to a shared manifest, addressed to the caller.
/// </summary>
public class ReceivedManifestInvitation
{
    /// <summary>Gets or sets the invitation id, used to accept or decline it.</summary>
    public required Guid Id { get; set; }

    /// <summary>Gets or sets the group the vault belongs to.</summary>
    public required Guid GroupId { get; set; }

    /// <summary>Gets or sets the vault being offered.</summary>
    public required Guid ManifestId { get; set; }

    /// <summary>Gets or sets the username of the member who sent it.</summary>
    public required string InviterUsername { get; set; }

    /// <summary>Gets or sets when it was sent.</summary>
    public required DateTime CreatedAt { get; set; }

    /// <summary>Gets or sets the encrypted name of the vault.</summary>
    public string? EncryptedName { get; set; }

    /// <summary>Gets or sets the public half of the recipient's keypair the offer was sealed to.</summary>
    public string? RecipientPublicKey { get; set; }
}
