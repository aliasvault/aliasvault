//-----------------------------------------------------------------------
// <copyright file="MailboxBulkRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Email;

/// <summary>
/// MailboxBulkRequest model for retrieving recent emails from multiple emailboxes.
/// </summary>
public class MailboxBulkRequest
{
    /// <summary>
    /// Gets or sets the mailbox addresses that client wants to retrieve emails for.
    /// </summary>
    public List<string> Addresses { get; set; } = [];

    /// <summary>
    /// Gets or sets requested page number.
    /// </summary>
    public int Page { get; set; }

    /// <summary>
    /// Gets or sets requested page size.
    /// </summary>
    public int PageSize { get; set; }
}
