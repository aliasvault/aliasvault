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

    /// <summary>Gets or sets the user id of the member who sent it, which <see cref="EncryptedNameSignature"/> names.</summary>
    public required string InviterUserId { get; set; }

    /// <summary>Gets or sets when it was sent.</summary>
    public required DateTime CreatedAt { get; set; }

    /// <summary>Gets or sets the encrypted name of the vault.</summary>
    public string? EncryptedName { get; set; }

    /// <summary>Gets or sets the inviter's signature over <see cref="EncryptedName"/>.</summary>
    public string? EncryptedNameSignature { get; set; }

    /// <summary>Gets or sets the inviter's signing public key that <see cref="EncryptedNameSignature"/> verifies under.</summary>
    public string? SignerPublicKey { get; set; }

    /// <summary>Gets or sets the recipient's account public key the offer was encrypted to.</summary>
    public string? RecipientAccountPublicKey { get; set; }

    /// <summary>Gets or sets the algorithm the offer was encrypted with, as a VaultKeyAlgorithm token.</summary>
    public required string Algorithm { get; set; }
}
