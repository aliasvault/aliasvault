//-----------------------------------------------------------------------
// <copyright file="EdgeCsvRecord.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models.Imports;

using CsvHelper.Configuration.Attributes;

/// <summary>
/// Represents an Edge CSV record that is being imported from a Microsoft Edge Password Manager CSV export file.
/// </summary>
public class EdgeCsvRecord
{
    /// <summary>
    /// Gets or sets the name of the item.
    /// </summary>
    [Name("name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the URL of the item.
    /// </summary>
    [Name("url")]
    public string Url { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the username of the item.
    /// </summary>
    [Name("username")]
    public string Username { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the password of the item.
    /// </summary>
    [Name("password")]
    public string Password { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets any additional notes.
    /// </summary>
    [Name("note")]
    public string? Note { get; set; }
}
