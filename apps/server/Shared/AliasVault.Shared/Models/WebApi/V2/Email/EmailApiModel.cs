//-----------------------------------------------------------------------
// <copyright file="EmailApiModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Email;

using AliasVault.Shared.Models.Spamok;

/// <summary>
/// Represents the email API model.
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
    /// Gets or sets the source content of the email message.
    /// </summary>
    public string? MessageSource { get; set; }

    /// <summary>
    /// Gets or sets the list of attachments in the email.
    /// </summary>
    public List<AttachmentApiModel> Attachments { get; set; } = [];
}
