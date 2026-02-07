//-----------------------------------------------------------------------
// <copyright file="ResetVaultOutput.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore;

/// <summary>
/// Output structure from vault reset operation.
/// </summary>
public class ResetVaultOutput
{
    /// <summary>
    /// Gets or sets a value indicating whether the reset operation was successful.
    /// </summary>
    public bool Success { get; set; }

    /// <summary>
    /// Gets or sets the SQL statements to execute on the local database.
    /// </summary>
    public List<SqlStatement> Statements { get; set; } = new();

    /// <summary>
    /// Gets or sets the error message if reset failed.
    /// </summary>
    public string? Error { get; set; }
}
