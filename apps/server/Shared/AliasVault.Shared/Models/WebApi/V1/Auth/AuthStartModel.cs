//-----------------------------------------------------------------------
// <copyright file="AuthStartModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Auth;

/// <summary>
/// Auth start model using SRP (Secure Remote Password) protocol.
/// </summary>
public class AuthStartModel
{
    /// <summary>
    /// Initializes a new instance of the <see cref="AuthStartModel"/> class.
    /// </summary>
    /// <param name="email">Email.</param>
    public AuthStartModel(string email)
    {
        this.Email = email;
    }

    /// <summary>
    /// Gets or sets the email.
    /// </summary>
    public string Email { get; set; }
}
