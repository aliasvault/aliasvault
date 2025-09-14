//-----------------------------------------------------------------------
// <copyright file="CredentialSortOrder.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

/// <summary>
/// Defines the sort order options for credentials.
/// </summary>
public enum CredentialSortOrder
{
    /// <summary>
    /// Sort by creation date, oldest first.
    /// </summary>
    OldestFirst,

    /// <summary>
    /// Sort by creation date, newest first.
    /// </summary>
    NewestFirst,

    /// <summary>
    /// Sort alphabetically by service name.
    /// </summary>
    Alphabetical,
}
