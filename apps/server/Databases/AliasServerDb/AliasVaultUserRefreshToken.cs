//-----------------------------------------------------------------------
// <copyright file="AliasVaultUserRefreshToken.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------
namespace AliasServerDb;

using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

/// <summary>
/// Refresh tokens for users. Only a hash of the token is stored; the token itself lives on the client.
/// </summary>
public class AliasVaultUserRefreshToken
{
    /// <summary>
    /// Gets or sets Refresh Token ID.
    /// </summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets user ID foreign key.
    /// </summary>
    [StringLength(255)]
    public string UserId { get; set; } = null!;

    /// <summary>
    /// Gets or sets foreign key to the AliasVaultUser object.
    /// </summary>
    [ForeignKey("UserId")]
    public virtual AliasVaultUser User { get; set; } = null!;

    /// <summary>
    /// Gets or sets the device identifier (one token per device).
    /// </summary>
    public string DeviceIdentifier { get; set; } = null!;

    /// <summary>
    /// Gets or sets the IP address associated with the refresh token.
    /// </summary>
    [StringLength(45)]
    public string? IpAddress { get; set; }

    /// <summary>
    /// Gets or sets the SHA-256 hash (lowercase hex) of the token value the client holds.
    /// </summary>
    [StringLength(64)]
    public string TokenHash { get; set; } = null!;

    /// <summary>
    /// Gets or sets the hash of the token this one replaced on rotation, if any.
    /// </summary>
    [StringLength(64)]
    public string? PreviousTokenHash { get; set; }

    /// <summary>
    /// Gets or sets the expiration date.
    /// </summary>
    [StringLength(255)]
    public DateTime ExpireDate { get; set; }

    /// <summary>
    /// Gets or sets created timestamp.
    /// </summary>
    public DateTime CreatedAt { get; set; }
}
