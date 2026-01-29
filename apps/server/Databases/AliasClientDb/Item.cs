//-----------------------------------------------------------------------
// <copyright file="Item.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasClientDb.Abstracts;

/// <summary>
/// Item entity (renamed from Credential).
/// Represents a vault item that can be of various types (Login, CreditCard, Identity, etc.).
/// </summary>
public class Item : SyncableEntity
{
    /// <summary>
    /// Gets or sets the item ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the item name.
    /// </summary>
    [StringLength(255)]
    public string? Name { get; set; }

    /// <summary>
    /// Gets or sets the item type (Login, CreditCard, Identity, SecureNote, ApiKey, Passkey).
    /// </summary>
    [Required]
    [StringLength(50)]
    public string ItemType { get; set; } = "Login";

    /// <summary>
    /// Gets or sets the logo ID foreign key.
    /// </summary>
    public Guid? LogoId { get; set; }

    /// <summary>
    /// Gets or sets the logo object.
    /// </summary>
    [ForeignKey("LogoId")]
    public virtual Logo? Logo { get; set; }

    /// <summary>
    /// Gets or sets the timestamp when this item was moved to the "Recently Deleted" folder.
    /// When null, the item is active. When set, the item is in the trash and can be restored.
    /// After a configurable retention period (default 30 days), items with DeletedAt set
    /// are permanently deleted (converted to tombstones with IsDeleted = true).
    /// </summary>
    public DateTime? DeletedAt { get; set; }

    /// <summary>
    /// Gets or sets the folder ID foreign key.
    /// </summary>
    public Guid? FolderId { get; set; }

    /// <summary>
    /// Gets or sets the folder object.
    /// </summary>
    [ForeignKey("FolderId")]
    public virtual Folder? Folder { get; set; }

    /// <summary>
    /// Gets or sets the field value objects.
    /// </summary>
    public virtual ICollection<FieldValue> FieldValues { get; set; } = [];

    /// <summary>
    /// Gets or sets the attachment objects.
    /// </summary>
    public virtual ICollection<Attachment> Attachments { get; set; } = [];

    /// <summary>
    /// Gets or sets the TOTP code objects.
    /// </summary>
    public virtual ICollection<TotpCode> TotpCodes { get; set; } = [];

    /// <summary>
    /// Gets or sets the passkey objects.
    /// </summary>
    public virtual ICollection<Passkey> Passkeys { get; set; } = [];

    /// <summary>
    /// Gets or sets the item-tag relationships.
    /// </summary>
    public virtual ICollection<ItemTag> ItemTags { get; set; } = [];
}
