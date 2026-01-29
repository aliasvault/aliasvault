//-----------------------------------------------------------------------
// <copyright file="MobileLoginInitiateRequest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.Auth;

/// <summary>
/// Request model for initiating a mobile login request.
/// </summary>
public class MobileLoginInitiateRequest
{
    /// <summary>
    /// Gets or sets the public key from the client (base64 encoded).
    /// </summary>
    public required string ClientPublicKey { get; set; }
}
