//-----------------------------------------------------------------------
// <copyright file="Passkey.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasClientDb.Abstracts;

/// <summary>
/// The Passkey class that stores WebAuthn/FIDO2 passkey information.
/// </summary>
public class Passkey : SyncableEntity
{
    /// <summary>
    /// Gets or sets the ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the credential ID foreign key.
    /// </summary>
    [Required]
    public Guid CredentialId { get; set; }

    /// <summary>
    /// Gets or sets the credential object.
    /// </summary>
    [ForeignKey("CredentialId")]
    public virtual Credential Credential { get; set; } = null!;

    /// <summary>
    /// Gets or sets the relying party identifier.
    /// </summary>
    [Required]
    [MaxLength(255)]
    public string RpId { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the user ID provided by the relying party.
    /// </summary>
    [MaxLength(255)]
    public string? UserId { get; set; }

    /// <summary>
    /// Gets or sets the public key.
    /// </summary>
    public string PublicKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the private key.
    /// </summary>
    public string PrivateKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the PRF encryption key associated with the passkey (optional, only set if PRF was requested by RP).
    /// </summary>
    [MaxLength(64)]
    public byte[]? PrfKey { get; set; }

    /// <summary>
    /// Gets or sets the display name for the passkey.
    /// </summary>
    [MaxLength(255)]
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the additional data as JSON blob.
    /// </summary>
    public byte[]? AdditionalData { get; set; }
}
