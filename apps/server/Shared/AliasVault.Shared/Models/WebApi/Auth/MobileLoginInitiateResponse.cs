//-----------------------------------------------------------------------
// <copyright file="MobileLoginInitiateResponse.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.Auth;

/// <summary>
/// Response model for mobile login initiate request.
/// </summary>
public class MobileLoginInitiateResponse
{
    /// <summary>
    /// Gets or sets the unique identifier for this login request.
    /// </summary>
    public required string RequestId { get; set; }
}
