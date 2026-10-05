//-----------------------------------------------------------------------
// <copyright file="KebabCaseEnumConverter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2;

using System.Text.Json;
using System.Text.Json.Serialization;

/// <summary>
/// Serializes a V2 enum as its kebab-case name and rejects integers.
/// </summary>
public sealed class KebabCaseEnumConverter : JsonStringEnumConverter
{
    /// <summary>
    /// Initializes a new instance of the <see cref="KebabCaseEnumConverter"/> class.
    /// </summary>
    public KebabCaseEnumConverter()
        : base(JsonNamingPolicy.KebabCaseLower, allowIntegerValues: false)
    {
    }

    /// <summary>
    /// The kebab-case token of an enum value.
    /// </summary>
    /// <param name="value">The enum value.</param>
    /// <returns>The kebab-case token.</returns>
    public static string ToToken(Enum value) => JsonNamingPolicy.KebabCaseLower.ConvertName(value.ToString());
}
