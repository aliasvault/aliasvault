//-----------------------------------------------------------------------
// <copyright file="Email.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using Microsoft.EntityFrameworkCore;

/// <summary>
/// Represents an email message.
/// </summary>
[Index(nameof(To), nameof(DateSystem))]
[Index(nameof(Date))]
[Index(nameof(DateSystem))]
[Index(nameof(Visible))]
[Index(nameof(PushNotificationSent))]
public class Email
{
    /// <summary>
    /// Gets or sets the ID of the email.
    /// </summary>
    public int Id { get; set; }

    /// <summary>
    /// Gets or sets the wrapped copies of the symmetric key the email contents are encrypted with, one per
    /// manifest that had claimed the alias at delivery time.
    /// </summary>
    public virtual List<EmailKeyWrap> Wraps { get; set; } = [];

    /// <summary>
    /// Gets or sets the subject of the email.
    /// </summary>
    public string Subject { get; set; } = null!;

    /// <summary>
    /// Gets or sets the sender's email address.
    /// </summary>
    public string From { get; set; } = null!;

    /// <summary>
    /// Gets or sets the local part of the sender's email address.
    /// </summary>
    public string FromLocal { get; set; } = null!;

    /// <summary>
    /// Gets or sets the domain part of the sender's email address.
    /// </summary>
    public string FromDomain { get; set; } = null!;

    /// <summary>
    /// Gets or sets the recipient's email address.
    /// </summary>
    public string To { get; set; } = null!;

    /// <summary>
    /// Gets or sets the local part of the recipient's email address.
    /// </summary>
    public string ToLocal { get; set; } = null!;

    /// <summary>
    /// Gets or sets the domain part of the recipient's email address.
    /// </summary>
    public string ToDomain { get; set; } = null!;

    /// <summary>
    /// Gets or sets the date and time when the email was sent.
    /// </summary>
    public DateTime Date { get; set; }

    /// <summary>
    /// Gets or sets the system date and time when the email was received.
    /// </summary>
    public DateTime DateSystem { get; set; }

    /// <summary>
    /// Gets or sets the HTML content of the email message. No longer served by the v2 API and no longer filled in since 0.31.0 in favor of MessageSource. TODO: remove this column in a future version.
    /// </summary>
    public string? MessageHtml { get; set; }

    /// <summary>
    /// Gets or sets the plain text content of the email message. No longer served by the v2 API and no longer filled in since 0.31.0 in favor of MessageSource. TODO: remove this column in a future version.
    /// </summary>
    public string? MessagePlain { get; set; }

    /// <summary>
    /// Gets or sets the preview of the email message.
    /// </summary>
    public string? MessagePreview { get; set; }

    /// <summary>
    /// Gets or sets the source of the email message. Only set on legacy rows; newer rows store the
    /// source in <see cref="MessageSourceBytes"/> instead.
    /// </summary>
    public string? MessageSource { get; set; }

    /// <summary>
    /// Gets or sets the gzip-compressed and encrypted raw RFC 822 source of the email message. The single authoritative
    /// body copy for emails stored in the source-only format; clients detect the compression via the gzip magic bytes (0x1f 0x8b) after decrypt.
    /// </summary>
    public byte[]? MessageSourceBytes { get; set; }

    /// <summary>
    /// Gets or sets the number of attachments contained in the email message. Stamped at ingest so list
    /// views can show an attachment indicator without parsing the encrypted source.
    /// </summary>
    public int AttachmentCount { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the email is visible.
    /// </summary>
    public bool Visible { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether a push notification has been sent for the email.
    /// </summary>
    public bool PushNotificationSent { get; set; }

    /// <summary>
    /// Gets or sets the collection of email attachments.
    /// </summary>
    public virtual List<EmailAttachment> Attachments { get; set; } = [];
}
