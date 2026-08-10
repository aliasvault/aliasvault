//-----------------------------------------------------------------------
// <copyright file="TotpCode.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasClientDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using AliasClientDb.Abstracts;

/// <summary>
/// The TotpCode class that stores 2FA information associated with a credential.
/// </summary>
public class TotpCode : ManifestScopedEntity
{
    /// <summary>
    /// The HMAC algorithm assumed by RFC 6238 when an <c>otpauth://</c> URI omits the <c>algorithm</c> parameter.
    /// </summary>
    public const string AlgorithmSha1 = "SHA1";

    /// <summary>
    /// The SHA-256 HMAC algorithm.
    /// </summary>
    public const string AlgorithmSha256 = "SHA256";

    /// <summary>
    /// The SHA-512 HMAC algorithm.
    /// </summary>
    public const string AlgorithmSha512 = "SHA512";

    /// <summary>
    /// The code length assumed by RFC 6238 when an <c>otpauth://</c> URI omits the <c>digits</c> parameter.
    /// </summary>
    public const int DefaultDigits = 6;

    /// <summary>
    /// The time step in seconds assumed by RFC 6238 when an <c>otpauth://</c> URI omits the <c>period</c> parameter.
    /// </summary>
    public const int DefaultPeriod = 30;

    /// <summary>
    /// Gets or sets the ID.
    /// </summary>
    [DatabaseGenerated(DatabaseGeneratedOption.Identity)]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the name of the TOTP code.
    /// </summary>
    [MaxLength(255)]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the secret key for the TOTP code.
    /// </summary>
    [MaxLength(255)]
    public string SecretKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the HMAC algorithm used to derive the code: <see cref="AlgorithmSha1"/>,
    /// <see cref="AlgorithmSha256"/> or <see cref="AlgorithmSha512"/>. An unrecognized value is treated
    /// as <see cref="AlgorithmSha1"/> by the generators rather than failing the whole item.
    /// </summary>
    [Required]
    [StringLength(20)]
    public string Algorithm { get; set; } = AlgorithmSha1;

    /// <summary>
    /// Gets or sets the number of digits in the generated code, typically 6 or 8.
    /// </summary>
    public int Digits { get; set; } = DefaultDigits;

    /// <summary>
    /// Gets or sets the time step in seconds a code stays valid for, typically 30 or 60.
    /// </summary>
    public int Period { get; set; } = DefaultPeriod;

    /// <summary>
    /// Gets or sets the item ID.
    /// </summary>
    public Guid ItemId { get; set; }

    /// <summary>
    /// Gets or sets the item.
    /// </summary>
    public virtual Item? Item { get; set; }
}
