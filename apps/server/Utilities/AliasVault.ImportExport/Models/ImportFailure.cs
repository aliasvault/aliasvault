//-----------------------------------------------------------------------
// <copyright file="ImportFailure.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models;

/// <summary>
/// Represents a single item that failed to be parsed during an import.
/// Captured alongside successfully imported credentials so the user can see which entries were skipped.
/// </summary>
public class ImportFailure
{
    /// <summary>
    /// Gets or sets the zero-based index of the item within the source export.
    /// </summary>
    public int Index { get; set; }

    /// <summary>
    /// Gets or sets the title of the failing item, if it could be read.
    /// </summary>
    public string? ItemTitle { get; set; }

    /// <summary>
    /// Gets or sets the exception type name (e.g., "JsonException").
    /// </summary>
    public string ExceptionType { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the exception message describing what went wrong.
    /// </summary>
    public string Message { get; set; } = string.Empty;
}
