//-----------------------------------------------------------------------
// <copyright file="MailboxBulkResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Email;

using AliasVault.Shared.Models.Spamok;

/// <summary>
/// Represents a mailbox API model.
/// </summary>
public class MailboxBulkResponse
{
    /// <summary>
    /// Gets or sets the mailbox addresses that client wants to retrieve emails for.
    /// </summary>
    public List<string> Addresses { get; set; } = new();

    /// <summary>
    /// Gets or sets requested page number.
    /// </summary>
    public int CurrentPage { get; set; }

    /// <summary>
    /// Gets or sets requested page size.
    /// </summary>
    public int PageSize { get; set; }

    /// <summary>
    /// Gets or sets total number of emails.
    /// </summary>
    public int TotalRecords { get; set; }

    /// <summary>
    /// Gets or sets the list of mailbox email API models.
    /// </summary>
    public List<MailboxEmailApiModel> Mails { get; set; } = [];
}
