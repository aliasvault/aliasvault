//-----------------------------------------------------------------------
// <copyright file="RoboformCsvRecord.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models.Imports;

using CsvHelper.Configuration.Attributes;

/// <summary>
/// Represents a RoboForm CSV record that is being imported from a RoboForm CSV export file.
/// </summary>
public class RoboformCsvRecord
{
    /// <summary>
    /// Gets or sets the name of the item.
    /// </summary>
    [Name("Name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the URL of the item.
    /// </summary>
    [Name("Url")]
    public string? Url { get; set; }

    /// <summary>
    /// Gets or sets the match URL used for auto-fill matching.
    /// </summary>
    [Name("MatchUrl")]
    public string? MatchUrl { get; set; }

    /// <summary>
    /// Gets or sets the login/username.
    /// </summary>
    [Name("Login")]
    public string? Login { get; set; }

    /// <summary>
    /// Gets or sets the password.
    /// </summary>
    [Name("Pwd")]
    public string? Password { get; set; }

    /// <summary>
    /// Gets or sets any notes.
    /// </summary>
    [Name("Note")]
    public string? Note { get; set; }

    /// <summary>
    /// Gets or sets the folder path (e.g., "/Business").
    /// </summary>
    [Name("Folder")]
    public string? Folder { get; set; }

    /// <summary>
    /// Gets or sets the RoboForm fields version 2 data.
    /// This contains additional custom fields in a specific format.
    /// </summary>
    [Name("RfFieldsV2")]
    [Optional]
    public string? RfFieldsV2 { get; set; }
}
