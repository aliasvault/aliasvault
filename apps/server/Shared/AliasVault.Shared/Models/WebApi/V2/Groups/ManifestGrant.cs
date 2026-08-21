//-----------------------------------------------------------------------
// <copyright file="ManifestGrant.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Groups;

/// <summary>
/// One recipient's access to a shared manifest: the manifest's VEK encrypted with a public key of theirs.
/// </summary>
public class ManifestGrant
{
    /// <summary>Gets or sets the recipient this grant is for.</summary>
    public required string RecipientUserId { get; set; }

    /// <summary>Gets or sets the id of the recipient public key used to encrypt (see <see cref="GroupMemberInfo.PublicKeyId"/>).</summary>
    public required Guid RecipientPublicKeyId { get; set; }

    /// <summary>Gets or sets the manifest VEK encrypted with that public key (base64), decryptable only by the recipient.</summary>
    public required string EncryptedVek { get; set; }

    /// <summary>Gets or sets the vault's name encrypted with the same public key, null when the client sealed none.</summary>
    public string? EncryptedName { get; set; }
}
