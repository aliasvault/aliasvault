//-----------------------------------------------------------------------
// <copyright file="PruneInput.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore;

/// <summary>
/// Input structure for vault prune operation.
/// </summary>
public class PruneInput
{
    /// <summary>
    /// Gets or sets the table data to prune.
    /// </summary>
    public List<TableData> Tables { get; set; } = new();

    /// <summary>
    /// Gets or sets the retention period in days (items older than this in trash will be pruned).
    /// </summary>
    public int RetentionDays { get; set; } = 30;
}
