//-----------------------------------------------------------------------
// <copyright file="EmailApiModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Email;

/// <summary>
/// Represents an email API model of the AliasVault V1 email API.
/// </summary>
public class EmailApiModel : EmailApiModelBase
{
    /// <summary>
    /// Gets or sets the HTML content of the email message. Null for emails stored in the source-only
    /// format, whose bodies live inside <see cref="MessageSource"/> only.
    /// </summary>
    public string? MessageHtml { get; set; }

    /// <summary>
    /// Gets or sets the plain text content of the email message. Null for emails stored in the source-only
    /// format, whose bodies live inside <see cref="MessageSource"/> only.
    /// </summary>
    public string? MessagePlain { get; set; }

    /// <summary>
    /// Gets or sets the source content of the email message as base64 ciphertext. For emails stored in the
    /// source-only format the decrypted plaintext is gzip-compressed, which clients detect via the gzip
    /// magic bytes (0x1f 0x8b) before parsing the bodies and attachments out of it.
    /// </summary>
    public string? MessageSource { get; set; }

    /// <summary>
    /// Gets or sets the list of attachments in the email. Only populated for emails that carry separate
    /// attachment records; emails stored in the source-only format have their attachments inside the source.
    /// </summary>
    public List<AttachmentApiModel> Attachments { get; set; } = [];
}
