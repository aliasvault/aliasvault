//-----------------------------------------------------------------------
// <copyright file="PasswordSettings.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models;

using System.Text.Json.Serialization;
using AliasClientDb.Models;

/// <summary>
/// Settings for password generation.
/// </summary>
public class PasswordSettings
{
    /// <summary>
    /// Gets or sets the length of the password.
    /// </summary>
    [JsonPropertyName("Length")]
    public int Length { get; set; } = PasswordGeneratorDefaults.DefaultPasswordLength;

    /// <summary>
    /// Gets or sets a value indicating whether to use lowercase letters.
    /// </summary>
    [JsonPropertyName("UseLowercase")]
    public bool UseLowercase { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether to use uppercase letters.
    /// </summary>
    [JsonPropertyName("UseUppercase")]
    public bool UseUppercase { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether to use numbers.
    /// </summary>
    [JsonPropertyName("UseNumbers")]
    public bool UseNumbers { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether to use special characters.
    /// </summary>
    [JsonPropertyName("UseSpecialChars")]
    public bool UseSpecialChars { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether to use non-ambiguous characters.
    /// </summary>
    [JsonPropertyName("UseNonAmbiguousChars")]
    public bool UseNonAmbiguousChars { get; set; } = false;

    /// <summary>
    /// Gets or sets which generator to use ("basic" or "diceware"). Defaults to "basic".
    /// </summary>
    [JsonPropertyName("Type")]
    public string Type { get; set; } = "basic";

    /// <summary>
    /// Gets or sets the number of words in a Diceware passphrase.
    /// </summary>
    [JsonPropertyName("WordCount")]
    public int WordCount { get; set; } = PasswordGeneratorDefaults.DefaultWordCount;

    /// <summary>
    /// Gets or sets the Diceware wordlist language. Empty means "auto": the most appropriate available
    /// wordlist is resolved from the app language at runtime.
    /// </summary>
    [JsonPropertyName("Language")]
    public string Language { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the Diceware capitalization ("None", "TitleCase", "Uppercase", "Lowercase" or "Random").
    /// </summary>
    [JsonPropertyName("Capitalization")]
    public string Capitalization { get; set; } = "Lowercase";

    /// <summary>
    /// Gets or sets the separator between Diceware words ("None", "Dash", "Space", "Underscore" or "Dot").
    /// </summary>
    [JsonPropertyName("Separator")]
    public string Separator { get; set; } = "Dash";

    /// <summary>
    /// Gets or sets the optional random salt character for a Diceware passphrase ("None", "Prefix", "Sprinkle" or "Suffix").
    /// </summary>
    [JsonPropertyName("Salt")]
    public string Salt { get; set; } = "None";
}
