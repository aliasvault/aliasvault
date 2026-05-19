//-----------------------------------------------------------------------
// <copyright file="ImportFileResult.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models;

/// <summary>
/// Result returned by an import file processor. Contains the credentials that were
/// successfully parsed plus a list of per-item failures that were skipped.
/// </summary>
public class ImportFileResult
{
    /// <summary>
    /// Gets the credentials that were successfully parsed from the file.
    /// </summary>
    public List<ImportedCredential> Credentials { get; init; } = new();

    /// <summary>
    /// Gets the list of items that could not be parsed and were skipped.
    /// </summary>
    public List<ImportFailure> FailedItems { get; init; } = new();

    /// <summary>
    /// Implicit conversion from a plain credential list. Lets importers that don't support
    /// per-item failure collection (CSV imports, etc.) return a List directly without boilerplate.
    /// </summary>
    /// <param name="credentials">The credentials to wrap.</param>
    public static implicit operator ImportFileResult(List<ImportedCredential> credentials) =>
        new() { Credentials = credentials };
}
