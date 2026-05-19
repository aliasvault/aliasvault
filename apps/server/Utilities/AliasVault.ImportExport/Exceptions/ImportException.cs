//-----------------------------------------------------------------------
// <copyright file="ImportException.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Exceptions;

/// <summary>
/// Identifies which stage of the import pipeline produced an error.
/// </summary>
public enum ImportStage
{
    /// <summary>The file could not be opened or read as an archive (corrupt zip, truncated download, etc.).</summary>
    Archive,

    /// <summary>The archive could be opened but its contents could not be parsed (missing manifest, malformed JSON, unexpected schema).</summary>
    Parse,

    /// <summary>The parsed credentials could not be saved into the local vault database.</summary>
    Save,
}

/// <summary>
/// Exception raised by importers when a catastrophic (non-per-item) failure occurs.
/// Carries the stage so the UI can present an actionable, copyable error payload.
/// </summary>
public class ImportException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="ImportException"/> class.
    /// </summary>
    /// <param name="stage">The pipeline stage where the failure happened.</param>
    /// <param name="message">A human-readable description of what went wrong.</param>
    public ImportException(ImportStage stage, string message)
        : base(message)
    {
        Stage = stage;
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="ImportException"/> class.
    /// </summary>
    /// <param name="stage">The pipeline stage where the failure happened.</param>
    /// <param name="message">A human-readable description of what went wrong.</param>
    /// <param name="innerException">The exception that triggered this failure.</param>
    public ImportException(ImportStage stage, string message, Exception innerException)
        : base(message, innerException)
    {
        Stage = stage;
    }

    /// <summary>
    /// Gets the pipeline stage where the failure happened.
    /// </summary>
    public ImportStage Stage { get; }
}
