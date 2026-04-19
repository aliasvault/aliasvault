//-----------------------------------------------------------------------
// <copyright file="EmailApiModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.Spamok;

using AliasVault.Shared.Models.Spamok.Base;

/// <summary>
/// Represents an email API model.
/// </summary>
public class EmailApiModel : EmailApiModelBase
{
    /// <summary>
    /// Gets or sets the HTML content of the email message.
    /// </summary>
    public string? MessageHtml { get; set; }

    /// <summary>
    /// Gets or sets the plain text content of the email message.
    /// </summary>
    public string? MessagePlain { get; set; }

    /// <summary>
    /// Gets or sets the raw source (RFC 822 / MIME) of the email message.
    /// </summary>
    public string? MessageSource { get; set; }

    /// <summary>
    /// Gets or sets the list of attachments in the email.
    /// </summary>
    public List<AttachmentApiModel> Attachments { get; set; } = [];
}
