//-----------------------------------------------------------------------
// <copyright file="EmailBulkRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.Email;

/// <summary>
/// EmailBulkRequest model for retrieving recent emails from multiple emailboxes.
/// </summary>
public class EmailBulkRequest
{
    /// <summary>
    /// Gets or sets the list of email IDs.
    /// </summary>
    public List<int> Ids { get; set; } = [];
}
