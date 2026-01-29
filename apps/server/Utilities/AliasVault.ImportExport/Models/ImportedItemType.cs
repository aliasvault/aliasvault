//-----------------------------------------------------------------------
// <copyright file="ImportedItemType.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models;

/// <summary>
/// Represents the type of item being imported from a password manager.
/// Each importer is responsible for mapping its source types to these values.
/// </summary>
public enum ImportedItemType
{
    /// <summary>
    /// Standard login credentials (username/password).
    /// </summary>
    Login,

    /// <summary>
    /// Secure note without login credentials.
    /// </summary>
    Note,

    /// <summary>
    /// Credit card information.
    /// </summary>
    Creditcard,

    /// <summary>
    /// Identity/alias information (name, birthdate, etc).
    /// </summary>
    Alias,
}
