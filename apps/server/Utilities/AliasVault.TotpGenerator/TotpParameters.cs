//-----------------------------------------------------------------------
// <copyright file="TotpParameters.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TotpGenerator;

/// <summary>
/// The RFC 6238 parameters a TOTP code is generated with, and the normalization applied to values
/// read from an <c>otpauth://</c> URI or an imported vault.
/// </summary>
/// <param name="Algorithm">The HMAC algorithm: SHA1, SHA256 or SHA512.</param>
/// <param name="Digits">The number of digits in the generated code.</param>
/// <param name="Period">The time step in seconds a code stays valid for.</param>
public readonly record struct TotpParameters(string Algorithm, int Digits, int Period)
{
    /// <summary>
    /// The HMAC algorithm RFC 6238 assumes when an <c>otpauth://</c> URI omits the <c>algorithm</c> parameter.
    /// </summary>
    public const string DefaultAlgorithm = "SHA1";

    /// <summary>
    /// The code length RFC 6238 assumes when an <c>otpauth://</c> URI omits the <c>digits</c> parameter.
    /// </summary>
    public const int DefaultDigits = 6;

    /// <summary>
    /// The time step RFC 6238 assumes when an <c>otpauth://</c> URI omits the <c>period</c> parameter.
    /// </summary>
    public const int DefaultPeriod = 30;

    /// <summary>
    /// Gets the parameters every TOTP code falls back to when none were specified.
    /// </summary>
    public static TotpParameters Default => new(DefaultAlgorithm, DefaultDigits, DefaultPeriod);

    /// <summary>
    /// Normalizes a raw algorithm value to SHA1, SHA256 or SHA512, falling back to <see cref="DefaultAlgorithm"/>.
    /// </summary>
    /// <param name="value">Raw algorithm value, e.g. "sha256" or null.</param>
    /// <returns>A supported algorithm name in uppercase.</returns>
    public static string NormalizeAlgorithm(string? value)
    {
        var normalized = (value ?? string.Empty).Trim().ToUpperInvariant().Replace("-", string.Empty).Replace("_", string.Empty);
        return normalized is "SHA1" or "SHA256" or "SHA512" ? normalized : DefaultAlgorithm;
    }

    /// <summary>
    /// Normalizes a raw digits value to a supported code length, falling back to <see cref="DefaultDigits"/>.
    /// The 6-8 range matches what the authenticator ecosystem issues and what the mobile generators can compute.
    /// </summary>
    /// <param name="value">Raw digits value, e.g. "8" or null.</param>
    /// <returns>A usable digit count.</returns>
    public static int NormalizeDigits(string? value) => int.TryParse(value, out var parsed) ? NormalizeDigits(parsed) : DefaultDigits;

    /// <summary>
    /// Normalizes a digits value to a supported code length, falling back to <see cref="DefaultDigits"/>.
    /// </summary>
    /// <param name="value">Raw digits value.</param>
    /// <returns>A usable digit count.</returns>
    public static int NormalizeDigits(int value) => value is >= 6 and <= 8 ? value : DefaultDigits;

    /// <summary>
    /// Normalizes a raw period value to a positive time step, falling back to <see cref="DefaultPeriod"/>.
    /// </summary>
    /// <param name="value">Raw period value, e.g. "60" or null.</param>
    /// <returns>A usable period in seconds.</returns>
    public static int NormalizePeriod(string? value) => int.TryParse(value, out var parsed) ? NormalizePeriod(parsed) : DefaultPeriod;

    /// <summary>
    /// Normalizes a period value to a positive time step, falling back to <see cref="DefaultPeriod"/>.
    /// </summary>
    /// <param name="value">Raw period value.</param>
    /// <returns>A usable period in seconds.</returns>
    public static int NormalizePeriod(int value) => value is > 0 and <= 300 ? value : DefaultPeriod;
}
