//-----------------------------------------------------------------------
// <copyright file="LanguageOption.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.JsInterop.Models;

/// <summary>
/// Represents a language option for identity generation.
/// </summary>
public sealed class LanguageOption
{
    /// <summary>
    /// Gets or sets the language code (e.g., "en", "nl", "de").
    /// </summary>
    public string Value { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the display label in the native language (e.g., "English", "Nederlands", "Deutsch").
    /// </summary>
    public string Label { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the flag emoji for the language (e.g., "🇬🇧", "🇳🇱", "🇩🇪").
    /// </summary>
    public string Flag { get; set; } = string.Empty;
}
