//-----------------------------------------------------------------------
// <copyright file="LoginModel2Fa.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.Auth;

using System.ComponentModel.DataAnnotations;

/// <summary>
/// Login model for 2-factor authentication step using an authenticator code.
/// </summary>
public class LoginModel2Fa
{
    /// <summary>
    /// Gets or sets the 2-factor code.
    /// </summary>
    [Required]
    [Display(Name = "Authenticator Code")]
    public int? TwoFactorCode { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the current machine should not be asked for 2FA the next time.
    /// </summary>
    public bool RememberMachine { get; set; }
}
