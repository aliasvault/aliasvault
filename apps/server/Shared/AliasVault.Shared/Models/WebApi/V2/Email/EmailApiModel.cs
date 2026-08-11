//-----------------------------------------------------------------------
// <copyright file="EmailApiModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Email;

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
    /// Gets or sets the source content of the email message as base64 ciphertext. For source-only stored
    /// emails the decrypted plaintext is gzip-compressed: clients detect this via the gzip magic bytes
    /// (0x1f 0x8b) and parse the bodies and attachments from the decompressed source.
    /// </summary>
    public string? MessageSource { get; set; }

    /// <summary>
    /// Gets or sets the number of attachments contained in the email message.
    /// </summary>
    public int AttachmentCount { get; set; }

    /// <summary>
    /// Gets or sets the list of attachments in the email. Only populated for legacy emails that carry
    /// separate attachment records; for source-only emails clients extract attachments from the parsed source.
    /// </summary>
    public List<AttachmentApiModel> Attachments { get; set; } = [];
}
