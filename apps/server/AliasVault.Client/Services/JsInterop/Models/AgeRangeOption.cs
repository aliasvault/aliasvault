//-----------------------------------------------------------------------
// <copyright file="AgeRangeOption.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.Models;

/// <summary>
/// Represents an age range option for identity generation.
/// </summary>
public sealed class AgeRangeOption
{
    /// <summary>
    /// Gets or sets the value to store (e.g., "21-25", "random").
    /// </summary>
    public string Value { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the display label (e.g., "21-25", "Random").
    /// </summary>
    public string Label { get; set; } = string.Empty;
}
