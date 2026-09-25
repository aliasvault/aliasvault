//-----------------------------------------------------------------------
// <copyright file="EmailAttachmentViewModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

/// <summary>
/// An attachment of an email as shown in the UI.
/// </summary>
public sealed class EmailAttachmentViewModel
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
    /// Gets or sets the position of the attachment in the parsed message source, which its bytes are extracted by.
    /// </summary>
    public int Index { get; set; }

    /// <summary>
    /// Gets or sets the index the body is stored under when the server detached it from the source at ingest.
    /// Null when the body is still inline in the source.
    /// </summary>
    public int? PartIndex { get; set; }

    /// <summary>
    /// Gets or sets the attachment id of the external SpamOK API, which its bytes are downloaded by. Only set for
    /// emails of a public SpamOK mailbox, whose attachments are served as separate records instead of in a source.
    /// </summary>
    public int SpamOkId { get; set; }
}
