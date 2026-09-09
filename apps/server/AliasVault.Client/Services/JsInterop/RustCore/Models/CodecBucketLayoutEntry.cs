//-----------------------------------------------------------------------
// <copyright file="CodecBucketLayoutEntry.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore.Models;

/// <summary>
/// One entry in the bucket layout: a category and the tables it owns.
/// </summary>
public class CodecBucketLayoutEntry
{
    /// <summary>
    /// Gets or sets the bucket category (matches the server enum name, e.g. "Settings").
    /// </summary>
    public string Category { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the tables the category owns.
    /// </summary>
    public List<string> Tables { get; set; } = [];
}
