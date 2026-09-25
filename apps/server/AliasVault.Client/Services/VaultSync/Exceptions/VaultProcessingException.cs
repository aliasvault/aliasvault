//-----------------------------------------------------------------------
// <copyright file="VaultProcessingException.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.VaultSync.Exceptions;

using System.Text;

/// <summary>
/// Thrown when the vault was fetched but could not be decrypted, unpacked or materialized locally. Distinct from
/// network errors so the UI can surface the technical detail as a support report.
/// </summary>
public sealed class VaultProcessingException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="VaultProcessingException"/> class.
    /// </summary>
    /// <param name="source">Short identifier of the flow that failed, e.g. "vault-pull".</param>
    /// <param name="innerException">The underlying error.</param>
    public VaultProcessingException(string source, Exception innerException)
        : base(innerException.Message, innerException)
    {
        FlowSource = source;
    }

    /// <summary>
    /// Gets the flow that failed.
    /// </summary>
    public string FlowSource { get; }

    /// <summary>
    /// Builds the plain-text support report for this failure.
    /// </summary>
    /// <returns>The report text.</returns>
    public string ToReport()
    {
        var report = new StringBuilder();
        report.AppendLine($"Source: {FlowSource}");
        report.AppendLine($"Error: {InnerException?.GetType().Name}: {Message}");
        for (var inner = InnerException?.InnerException; inner is not null; inner = inner.InnerException)
        {
            report.AppendLine($"Caused by: {inner.GetType().Name}: {inner.Message}");
        }

        if (!string.IsNullOrEmpty(InnerException?.StackTrace))
        {
            report.AppendLine();
            report.AppendLine(InnerException.StackTrace);
        }

        return report.ToString().TrimEnd();
    }
}
