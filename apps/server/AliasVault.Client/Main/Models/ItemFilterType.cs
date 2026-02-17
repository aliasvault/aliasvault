//-----------------------------------------------------------------------
// <copyright file="ItemFilterType.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

/// <summary>
/// Filter types for the items list.
/// </summary>
public enum ItemFilterType
{
    /// <summary>
    /// Show all items.
    /// </summary>
    All,

    /// <summary>
    /// Filter by Login item type.
    /// </summary>
    Login,

    /// <summary>
    /// Filter by Alias item type.
    /// </summary>
    Alias,

    /// <summary>
    /// Filter by CreditCard item type.
    /// </summary>
    CreditCard,

    /// <summary>
    /// Filter by Note item type.
    /// </summary>
    Note,

    /// <summary>
    /// Show only items with passkeys.
    /// </summary>
    Passkeys,

    /// <summary>
    /// Show only items with attachments.
    /// </summary>
    Attachments,

    /// <summary>
    /// Show only items with TOTP codes (2FA).
    /// </summary>
    Totp,
}
