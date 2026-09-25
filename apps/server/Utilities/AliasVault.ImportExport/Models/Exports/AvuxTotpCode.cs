//-----------------------------------------------------------------------
// <copyright file="AvuxTotpCode.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.ImportExport.Models.Exports;

using AliasVault.TotpGenerator;

/// <summary>
/// Represents a TOTP code in an item.
/// </summary>
public class AvuxTotpCode
{
    /// <summary>
    /// Gets or sets the TOTP code ID.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the TOTP code name.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the TOTP secret key.
    /// </summary>
    public string SecretKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the HMAC algorithm: SHA1, SHA256 or SHA512.
    /// </summary>
    public string Algorithm { get; set; } = TotpParameters.DefaultAlgorithm;

    /// <summary>
    /// Gets or sets the number of digits in the generated code.
    /// </summary>
    public int Digits { get; set; } = TotpParameters.DefaultDigits;

    /// <summary>
    /// Gets or sets the time step in seconds a code stays valid for.
    /// </summary>
    public int Period { get; set; } = TotpParameters.DefaultPeriod;
}
