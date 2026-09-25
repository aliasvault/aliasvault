//-----------------------------------------------------------------------
// <copyright file="CodecValidation.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.RustCore.Models;

/// <summary>
/// Structural validation outcome of a manifest or data bucket.
/// </summary>
public class CodecValidation
{
    /// <summary>
    /// Gets or sets a value indicating whether the payload is valid.
    /// </summary>
    public bool Ok { get; set; }

    /// <summary>
    /// Gets or sets the stable ids of the rules that failed.
    /// </summary>
    public List<string> FailedRules { get; set; } = [];

    /// <summary>
    /// Gets or sets the human-readable failure description.
    /// </summary>
    public string Message { get; set; } = string.Empty;
}
