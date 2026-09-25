//-----------------------------------------------------------------------
// <copyright file="ParsedEmail.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore.Models;

/// <summary>
/// The result of parsing a raw RFC 822 email source.
/// </summary>
public class ParsedEmail
{
    /// <summary>
    /// Gets or sets the html body, null when the message has no html part.
    /// </summary>
    public string? HtmlBody { get; set; }

    /// <summary>
    /// Gets or sets the plain text body, null when the message has no text part.
    /// </summary>
    public string? TextBody { get; set; }

    /// <summary>
    /// Gets or sets the attachments contained in the message, in the index order the extract call expects.
    /// </summary>
    public List<ParsedEmailAttachment> Attachments { get; set; } = [];
}
