//-----------------------------------------------------------------------
// <copyright file="MailListViewModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Pages.Emails.Models;

/// <summary>
/// Mail view model.
/// </summary>
public class MailListViewModel
{
    /// <summary>
    /// Gets or sets the ID of the email.
    /// </summary>
    public int Id { get; set; }

    /// <summary>
    /// Gets or sets the ID of the associated credential that uses this email address.
    /// </summary>
    public Guid CredentialId { get; set; }

    /// <summary>
    /// Gets or sets the name of the credential that uses this email address.
    /// </summary>
    public string CredentialName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the subject of the email.
    /// </summary>
    public string Subject { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the display name of the sender.
    /// </summary>
    public string FromName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the sender's email address.
    /// </summary>
    public string FromEmail { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the recipients email address.
    /// </summary>
    public string ToEmail { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the date of the email.
    /// </summary>
    public DateTime Date { get; set; }

    /// <summary>
    /// Gets or sets the message preview.
    /// </summary>
    public string MessagePreview { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the email has attachments.
    /// </summary>
    public bool HasAttachments { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the email is checked on list view.
    /// </summary>
    public bool IsChecked { get; set; } = false;
}
