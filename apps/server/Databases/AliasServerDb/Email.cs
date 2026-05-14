//-----------------------------------------------------------------------
// <copyright file="Email.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
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
    /// Gets or sets encryption key foreign key.
    /// </summary>
    [StringLength(255)]
    public Guid UserEncryptionKeyId { get; set; }

    /// <summary>
    /// Gets or sets foreign key to the UserEncryptionKey object which contains the public key used for encrypting
    /// the symmetric encryption key.
    /// </summary>
    [ForeignKey("UserEncryptionKeyId")]
    public virtual UserEncryptionKey EncryptionKey { get; set; } = null!;

    /// <summary>
    /// Gets or sets the encrypted symmetric key which was used to encrypt the email message.
    /// This key is encrypted with the public key of the user.
    /// </summary>
    public string EncryptedSymmetricKey { get; set; } = null!;

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
    /// Gets or sets the HTML content of the email message.
    /// </summary>
    public string? MessageHtml { get; set; }

    /// <summary>
    /// Gets or sets the plain text content of the email message.
    /// </summary>
    public string? MessagePlain { get; set; }

    /// <summary>
    /// Gets or sets the preview of the email message.
    /// </summary>
    public string? MessagePreview { get; set; }

    /// <summary>
    /// Gets or sets the source of the email message.
    /// </summary>
    public string MessageSource { get; set; } = null!;

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
