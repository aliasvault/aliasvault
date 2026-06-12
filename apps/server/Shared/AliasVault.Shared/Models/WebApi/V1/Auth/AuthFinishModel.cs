//-----------------------------------------------------------------------
// <copyright file="AuthFinishModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.Auth;

/// <summary>
/// Auth finish model using SRP (Secure Remote Password) protocol.
/// </summary>
public class AuthFinishModel
{
    /// <summary>
    /// Initializes a new instance of the <see cref="AuthFinishModel"/> class.
    /// </summary>
    /// <param name="email">Email.</param>
    /// <param name="a">A.</param>
    /// <param name="m1">M1.</param>
    public AuthFinishModel(string email, string a, string m1)
    {
        Email = email;
        A = a;
        M1 = m1;
    }

    /// <summary>
    /// Gets or sets the email.
    /// </summary>
    public string Email { get; set; }

    /// <summary>
    /// Gets or sets A which is a value that is used to verify the user's identity.
    /// </summary>
    public string A { get; set; }

    /// <summary>
    /// Gets or sets M1 which is a value that is used to verify the user's identity.
    /// </summary>
    public string M1 { get; set; }
}
