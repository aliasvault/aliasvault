//-----------------------------------------------------------------------
// <copyright file="EmailBulkResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.Email;

/// <summary>
/// Represents a email bulk actions API model.
/// </summary>
public class EmailBulkResponse
{
    /// <summary>
    /// Gets or sets the emails that were deleted.
    /// </summary>
    public List<int> SuccessfulEmailIds { get; set; } = new();
}
