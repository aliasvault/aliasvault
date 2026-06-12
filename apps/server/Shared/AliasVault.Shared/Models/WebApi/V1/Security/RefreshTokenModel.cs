//-----------------------------------------------------------------------
// <copyright file="RefreshTokenModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Security;

/// <summary>
/// RefreshToken (user session) model.
/// </summary>
public class RefreshTokenModel
{
    /// <summary>
    /// Gets or sets the unique identifier for the refresh token.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the device identifier associated with the refresh token.
    /// </summary>
    public string DeviceIdentifier { get; set; } = null!;

    /// <summary>
    /// Gets or sets the expiration date of the refresh token.
    /// </summary>
    public DateTime ExpireDate { get; set; }

    /// <summary>
    /// Gets or sets the creation date of the refresh token.
    /// </summary>
    public DateTime CreatedAt { get; set; }
}
