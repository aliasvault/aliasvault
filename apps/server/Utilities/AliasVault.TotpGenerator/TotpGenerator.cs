﻿//-----------------------------------------------------------------------
// <copyright file="TotpGenerator.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TotpGenerator;

using OtpNet;

/// <summary>
/// Helper class to generate time based one-time passwords.
/// </summary>
public static class TotpGenerator
{
    /// <summary>
    /// Generates a Time-based One-Time Password (TOTP) for the given secret key.
    /// </summary>
    /// <param name="secretKey">The secret key in Base32 encoding.</param>
    /// <param name="digits">The number of digits in the generated code. Default is 6.</param>
    /// <param name="step">The time step in seconds. Default is 30.</param>
    /// <returns>The generated TOTP code.</returns>
    public static string GenerateTotpCode(string secretKey, int digits = 6, int step = 30)
    {
        // Remove any whitespace and hyphens from the secret key
        secretKey = secretKey.Replace(" ", string.Empty).Replace("-", string.Empty);

        // Convert the secret key from Base32 to byte array
        byte[] keyBytes = Base32Encoding.ToBytes(secretKey);

        // Create a new TOTP instance
        var totp = new Totp(keyBytes, step: step, totpSize: digits);

        // Generate and return the current TOTP code
        return totp.ComputeTotp();
    }

    /// <summary>
    /// Verifies a given TOTP code against the secret key.
    /// </summary>
    /// <param name="secretKey">The secret key in Base32 encoding.</param>
    /// <param name="totpCode">The TOTP code to verify.</param>
    /// <param name="digits">The number of digits in the code. Default is 6.</param>
    /// <param name="step">The time step in seconds. Default is 30.</param>
    /// <param name="timeWindowOffset">The time window offset for verification. Default is 1 (allows 1 step before and after).</param>
    /// <returns>True if the code is valid, false otherwise.</returns>
    public static bool VerifyTotpCode(string secretKey, string totpCode, int digits = 6, int step = 30, int timeWindowOffset = 1)
    {
        // Remove any whitespace and hyphens from the secret key
        secretKey = secretKey.Replace(" ", string.Empty).Replace("-", string.Empty);

        // Convert the secret key from Base32 to byte array
        byte[] keyBytes = Base32Encoding.ToBytes(secretKey);

        // Create a new TOTP instance
        var totp = new Totp(keyBytes, step: step, totpSize: digits);

        // Verify the TOTP code
        return totp.VerifyTotp(totpCode, out _, new VerificationWindow(previous: timeWindowOffset, future: timeWindowOffset));
    }
}
