//-----------------------------------------------------------------------
// <copyright file="PasswordChangeModel.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V1.PasswordChange;

/// <summary>
/// Password change model.
/// </summary>
public class PasswordChangeModel
{
    /// <summary>
    /// Gets or sets the current password.
    /// </summary>
    public string CurrentPassword { get; set; } = null!;

    /// <summary>
    /// Gets or sets the password.
    /// </summary>
    public string NewPassword { get; set; } = null!;

    /// <summary>
    /// Gets or sets the password confirmation.
    /// </summary>
    public string NewPasswordConfirm { get; set; } = null!;
}
