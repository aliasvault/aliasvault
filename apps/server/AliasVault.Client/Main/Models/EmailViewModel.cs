//-----------------------------------------------------------------------
// <copyright file="EmailViewModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

/// <summary>
/// An email ready to be shown: its decrypted metadata, plus the bodies and attachments that were parsed out of
/// the raw RFC 822 message source.
/// </summary>
public sealed class EmailViewModel
{
    /// <summary>
    /// Gets or sets the ID of the email.
    /// </summary>
    public int Id { get; set; }

    /// <summary>
    /// Gets or sets the subject of the email.
    /// </summary>
    public string Subject { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the display name of the sender.
    /// </summary>
    public string FromDisplay { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the local part of the sender's email address.
    /// </summary>
    public string FromLocal { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the domain of the sender's email address.
    /// </summary>
    public string FromDomain { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the local part of the recipient's email address.
    /// </summary>
    public string ToLocal { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the domain of the recipient's email address.
    /// </summary>
    public string ToDomain { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the system date of the email.
    /// </summary>
    public DateTime DateSystem { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the email comes from the external SpamOK API instead of AliasVault.
    /// </summary>
    public bool IsSpamOk { get; set; }

    /// <summary>
    /// Gets or sets the html body, null when the message has no html part.
    /// </summary>
    public string? HtmlBody { get; set; }

    /// <summary>
    /// Gets or sets the plain text body, null when the message has no text part.
    /// </summary>
    public string? TextBody { get; set; }

    /// <summary>
    /// Gets or sets the decrypted message source. Null for a SpamOK email, which serves its source as text.
    /// </summary>
    public byte[]? SourceBytes { get; set; }

    /// <summary>
    /// Gets or sets the raw message source as text.
    /// </summary>
    public string? SourceText { get; set; }

    /// <summary>
    /// Gets or sets the symmetric key the email was encrypted with, as base64.
    /// </summary>
    public string? SymmetricKey { get; set; }

    /// <summary>
    /// Gets or sets the attachments of the email.
    /// </summary>
    public List<EmailAttachmentViewModel> Attachments { get; set; } = [];

    /// <summary>
    /// Gets a value indicating whether a raw message source is available to show.
    /// </summary>
    public bool HasSource => SourceBytes is not null || !string.IsNullOrWhiteSpace(SourceText);
}
