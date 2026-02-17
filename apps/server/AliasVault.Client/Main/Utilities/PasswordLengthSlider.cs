// -----------------------------------------------------------------------
// <copyright file="PasswordLengthSlider.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
// -----------------------------------------------------------------------

namespace AliasVault.Client.Main.Utilities;

/// <summary>
/// Utility functions for password length slider with non-linear scaling.
///
/// The slider uses a power curve to provide fine-grained control at lower values
/// (where most users operate, e.g., 12-32 chars) and coarser control at higher values
/// (64-256 chars).
///
/// This makes it easy to select common password lengths while still allowing
/// very long passwords when needed.
/// </summary>
public static class PasswordLengthSlider
{
    /// <summary>
    /// Minimum password length.
    /// </summary>
    public const int MinPasswordLength = 8;

    /// <summary>
    /// Maximum password length.
    /// </summary>
    public const int MaxPasswordLength = 256;

    /// <summary>
    /// Slider minimum value (internal representation).
    /// </summary>
    public const double SliderMin = 0;

    /// <summary>
    /// Slider maximum value (internal representation).
    /// </summary>
    public const double SliderMax = 100;

    /// <summary>
    /// Exponent for the power curve.
    /// Higher values = more precision at lower lengths.
    /// 2.0 gives a good balance where ~50% slider = ~70 chars.
    /// </summary>
    private const double Exponent = 2.0;

    /// <summary>
    /// Convert a slider position (0-100) to an actual password length (8-256).
    /// Uses a power curve for non-linear scaling.
    /// </summary>
    /// <param name="sliderValue">The slider position (0-100).</param>
    /// <returns>The password length (8-256).</returns>
    public static int SliderToLength(double sliderValue)
    {
        var normalized = Math.Max(0, Math.Min(1, sliderValue / SliderMax));
        var curved = Math.Pow(normalized, Exponent);
        var length = MinPasswordLength + (curved * (MaxPasswordLength - MinPasswordLength));
        return (int)Math.Round(length);
    }

    /// <summary>
    /// Convert a password length (8-256) to a slider position (0-100).
    /// Inverse of SliderToLength.
    /// </summary>
    /// <param name="length">The password length (8-256).</param>
    /// <returns>The slider position (0-100).</returns>
    public static double LengthToSlider(int length)
    {
        var clampedLength = Math.Max(MinPasswordLength, Math.Min(MaxPasswordLength, length));
        var normalized = (double)(clampedLength - MinPasswordLength) / (MaxPasswordLength - MinPasswordLength);
        var curved = Math.Pow(normalized, 1.0 / Exponent);
        return curved * SliderMax;
    }
}
