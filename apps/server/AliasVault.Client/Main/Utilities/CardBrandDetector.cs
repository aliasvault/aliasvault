//-----------------------------------------------------------------------
// <copyright file="CardBrandDetector.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Utilities;

using System.Text.RegularExpressions;

/// <summary>
/// Utility for detecting credit card brand from card number.
/// Uses industry-standard BIN (Bank Identification Number) prefixes.
/// </summary>
public static partial class CardBrandDetector
{
    /// <summary>
    /// Credit card brand types.
    /// </summary>
    public enum CardBrand
    {
        /// <summary>
        /// Generic/unknown card brand.
        /// </summary>
        Generic,

        /// <summary>
        /// Visa card (starts with 4).
        /// </summary>
        Visa,

        /// <summary>
        /// Mastercard (starts with 51-55 or 2221-2720).
        /// </summary>
        Mastercard,

        /// <summary>
        /// American Express (starts with 34 or 37).
        /// </summary>
        Amex,

        /// <summary>
        /// Discover card (starts with 6011, 622, 644-649, 65).
        /// </summary>
        Discover,
    }

    /// <summary>
    /// Detect the card brand from a card number.
    /// </summary>
    /// <param name="cardNumber">The card number (may contain spaces or dashes).</param>
    /// <returns>The detected card brand.</returns>
    public static CardBrand Detect(string? cardNumber)
    {
        if (string.IsNullOrWhiteSpace(cardNumber))
        {
            return CardBrand.Generic;
        }

        // Remove spaces and dashes
        var cleaned = cardNumber.Replace(" ", string.Empty).Replace("-", string.Empty);

        // Must be mostly numeric (at least 4 digits)
        if (!NumericPrefixRegex().IsMatch(cleaned))
        {
            return CardBrand.Generic;
        }

        // Visa: starts with 4
        if (VisaRegex().IsMatch(cleaned))
        {
            return CardBrand.Visa;
        }

        // Mastercard: starts with 51-55 or 2221-2720
        if (MastercardRegex().IsMatch(cleaned))
        {
            return CardBrand.Mastercard;
        }

        // Amex: starts with 34 or 37
        if (AmexRegex().IsMatch(cleaned))
        {
            return CardBrand.Amex;
        }

        // Discover: starts with 6011, 622, 644-649, 65
        if (DiscoverRegex().IsMatch(cleaned))
        {
            return CardBrand.Discover;
        }

        return CardBrand.Generic;
    }

    [GeneratedRegex(@"^\d{4,}")]
    private static partial Regex NumericPrefixRegex();

    [GeneratedRegex(@"^4")]
    private static partial Regex VisaRegex();

    [GeneratedRegex(@"^(5[1-5]|2[2-7])")]
    private static partial Regex MastercardRegex();

    [GeneratedRegex(@"^3[47]")]
    private static partial Regex AmexRegex();

    [GeneratedRegex(@"^6(011|22|4[4-9]|5)")]
    private static partial Regex DiscoverRegex();
}
