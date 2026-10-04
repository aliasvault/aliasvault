//-----------------------------------------------------------------------
// <copyright file="MailboxBulkRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Email;

/// <summary>
/// Represents the bulk mailbox request. The server resolves the addresses from the caller's active alias claims.
/// </summary>
public class MailboxBulkRequest
{
    /// <summary>
    /// Gets or sets requested page number.
    /// </summary>
    public int Page { get; set; }

    /// <summary>
    /// Gets or sets requested page size.
    /// </summary>
    public int PageSize { get; set; }
}
