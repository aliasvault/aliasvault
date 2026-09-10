//-----------------------------------------------------------------------
// <copyright file="ParsedEmailAttachment.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore.Models;

/// <summary>
/// A single attachment of a parsed email message.
/// </summary>
public class ParsedEmailAttachment
{
    /// <summary>
    /// Gets or sets the attachment filename.
    /// </summary>
    public string Filename { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the MIME type of the attachment.
    /// </summary>
    public string MimeType { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the decoded attachment size in bytes.
    /// </summary>
    public long Size { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether this attachment's body lives outside the message source and has
    /// to be fetched separately before its bytes can be extracted.
    /// </summary>
    public bool Detached { get; set; }

    /// <summary>
    /// Gets or sets the index the detached body is stored under, to request it by. Null for an attachment whose
    /// body is still inline in the source.
    /// </summary>
    public int? PartIndex { get; set; }
}
