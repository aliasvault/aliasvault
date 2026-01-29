//-----------------------------------------------------------------------
// <copyright file="ItemListEntry.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

using System;

/// <summary>
/// Item list entry model for displaying items in lists.
/// </summary>
public sealed class ItemListEntry
{
    /// <summary>
    /// Gets or sets the Item ID.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the item type (Login, Alias, CreditCard, Note).
    /// </summary>
    public string ItemType { get; set; } = "Login";

    /// <summary>
    /// Gets or sets the Logo (favicon) bytes.
    /// </summary>
    public byte[]? Logo { get; set; }

    /// <summary>
    /// Gets or sets the Service name.
    /// </summary>
    public string? Service { get; set; }

    /// <summary>
    /// Gets or sets the Username.
    /// </summary>
    public string? Username { get; set; }

    /// <summary>
    /// Gets or sets the Email.
    /// </summary>
    public string? Email { get; set; }

    /// <summary>
    /// Gets or sets the card number (for CreditCard type, used for brand detection).
    /// </summary>
    public string? CardNumber { get; set; }

    /// <summary>
    /// Gets or sets the created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this item has a passkey.
    /// </summary>
    public bool HasPasskey { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this item has alias identity data.
    /// </summary>
    public bool HasAlias { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this item has a username or password.
    /// </summary>
    public bool HasUsernameOrPassword { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this item has attachments.
    /// </summary>
    public bool HasAttachment { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this item has TOTP codes.
    /// </summary>
    public bool HasTotp { get; set; }

    /// <summary>
    /// Gets or sets the folder ID this item belongs to.
    /// </summary>
    public Guid? FolderId { get; set; }

    /// <summary>
    /// Gets or sets the folder name this item belongs to.
    /// </summary>
    public string? FolderName { get; set; }
}
