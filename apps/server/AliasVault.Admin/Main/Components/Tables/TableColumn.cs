//-----------------------------------------------------------------------
// <copyright file="TableColumn.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Components.Tables;

/// <summary>
/// A class that represents a column in a table.
/// </summary>
public class TableColumn
{
    /// <summary>
    /// Gets or sets the title of the column.
    /// </summary>
    public required string Title { get; set; }

    /// <summary>
    /// Gets or sets the name of the property to bind to.
    /// </summary>
    public string? PropertyName { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the column is sortable.
    /// </summary>
    public bool Sortable { get; set; } = true;
}
