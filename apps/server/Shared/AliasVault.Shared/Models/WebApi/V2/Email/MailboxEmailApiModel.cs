//-----------------------------------------------------------------------
// <copyright file="MailboxEmailApiModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Email;

/// <summary>
/// Represents the mailbox email API model.
/// </summary>
public class MailboxEmailApiModel : EmailApiModelBase
{
    /// <summary>
    /// Gets or sets the preview of the email message.
    /// </summary>
    public string MessagePreview { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the email has attachments.
    /// </summary>
    public bool HasAttachments { get; set; }
}
