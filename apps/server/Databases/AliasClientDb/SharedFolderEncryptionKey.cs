//-----------------------------------------------------------------------
// <copyright file="SharedFolderEncryptionKey.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using AliasClientDb.Abstracts;

/// <summary>
/// A shared folder's own email keypair: the folder-scoped counterpart of <see cref="EncryptionKey"/>.
/// <para>
/// Mail addressed to an alias that lives in a shared folder is encrypted by the SMTP service with this
/// keypair's public half instead of the routing owner's personal key, so every member of the folder can
/// decrypt it. The private half is safe to store here because these rows live exclusively in the shared
/// folder's manifest, encrypted under that folder's VEK — the same key that already gates the folder's
/// contents. Whoever can open the folder can read its mail; nobody else can.
/// </para>
/// <para>
/// This is the mirror image of <see cref="EncryptionKey"/>, and the Rust codec enforces both directions:
/// <c>EncryptionKeys</c> is a personal table that must never enter a shared manifest, while
/// <c>SharedFolderEncryptionKeys</c> is a shared-only table that must never enter the root manifest, and
/// whose rows are dropped if they claim a <see cref="SharedFolderId"/> other than the manifest that carried them.
/// See <c>core/rust/src/vault_codec/types.rs</c> (PERSONAL_TABLES / SHARED_ONLY_TABLES).
/// </para>
/// </summary>
public class SharedFolderEncryptionKey : SyncableEntity
{
    /// <summary>
    /// Gets or sets the primary key.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the shared folder this keypair belongs to. Never null: a folder keypair has no
    /// meaning outside its folder, and canonicalize drops rows whose scope resolves to no shared folder
    /// rather than letting them fall back into the personal vault.
    /// </summary>
    [Required]
    public Guid SharedFolderId { get; set; }

    /// <summary>
    /// Gets or sets the public key. Published to the server (as a manifest-scoped EncryptionKey) so
    /// the SMTP service can encrypt incoming mail for the folder's aliases without decrypting anything.
    /// </summary>
    [Required]
    [StringLength(2000)]
    public string PublicKey { get; set; } = null!;

    /// <summary>
    /// Gets or sets the private key, used by every member to decrypt mail sent to the folder's aliases.
    /// </summary>
    [Required]
    [StringLength(2000)]
    public string PrivateKey { get; set; } = null!;

    /// <summary>
    /// Gets or sets a value indicating whether this is the folder's active keypair — the one whose public
    /// half is published for delivery. Exactly one live row per folder is primary.
    /// <para>
    /// Revoking a member rotates the folder VEK and mints a new primary keypair here, because the revoked
    /// member still holds the old private key and would otherwise keep decrypting future mail. Superseded
    /// rows are retained (not deleted) so mail received before the rotation stays readable; revocation is
    /// forward-only and cannot un-read what the revoked member already had.
    /// </para>
    /// </summary>
    public bool IsPrimary { get; set; }
}
