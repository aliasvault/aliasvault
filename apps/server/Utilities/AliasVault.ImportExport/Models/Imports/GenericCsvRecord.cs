//-----------------------------------------------------------------------
// <copyright file="GenericCsvRecord.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

using CsvHelper.Configuration.Attributes;

namespace AliasVault.ImportExport.Models.Imports;

/// <summary>
/// Represents a generic CSV record for importing credentials into AliasVault.
/// This provides a simple template structure for users who want to import from other sources.
/// </summary>
public class GenericCsvRecord
{
    /// <summary>
    /// Gets or sets the service name (e.g., "Gmail", "Facebook").
    /// </summary>
    [Name("service_name")]
    public string ServiceName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the service URL (optional).
    /// </summary>
    [Name("url")]
    public string? Url { get; set; }

    /// <summary>
    /// Gets or sets the username.
    /// </summary>
    [Name("username")]
    public string? Username { get; set; }

    /// <summary>
    /// Gets or sets the password.
    /// </summary>
    [Name("password")]
    public string? Password { get; set; }

    /// <summary>
    /// Gets or sets the two-factor authentication secret (TOTP).
    /// </summary>
    [Name("totp_secret")]
    public string? TotpSecret { get; set; }

    /// <summary>
    /// Gets or sets any additional notes.
    /// </summary>
    [Name("notes")]
    public string? Notes { get; set; }

    /// <summary>
    /// Gets or sets the folder path (optional). Supports multi-level paths separated by "/" (e.g., "Personal/Social").
    /// </summary>
    [Name("folder")]
    public string? Folder { get; set; }
}
