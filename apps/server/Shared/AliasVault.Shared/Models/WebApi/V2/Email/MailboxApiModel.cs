//-----------------------------------------------------------------------
// <copyright file="MailboxApiModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Email;

/// <summary>
/// Represents the mailbox API model.
/// </summary>
public class MailboxApiModel
{
    /// <summary>
    /// Gets or sets the address of the mailbox.
    /// </summary>
    public string Address { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the mailbox is subscribed.
    /// </summary>
    public bool Subscribed { get; set; }

    /// <summary>
    /// Gets or sets the list of mailbox email API models.
    /// </summary>
    public List<MailboxEmailApiModel> Mails { get; set; } = [];
}
