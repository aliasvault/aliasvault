//-----------------------------------------------------------------------
// <copyright file="PasswordChangeFormModel.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Main.Models.Validation;

using System.ComponentModel.DataAnnotations;
using AliasVault.Client.Resources;
using AliasVault.Shared.Models.WebApi.PasswordChange;

/// <summary>
/// Password change form model with validation.
/// </summary>
public class PasswordChangeFormModel : PasswordChangeModel
{
    /// <summary>
    /// Gets or sets the current password.
    /// </summary>
    [Required]
    public new string CurrentPassword { get; set; } = null!;

    /// <summary>
    /// Gets or sets the new password.
    /// </summary>
    [Required]
    [MinLength(10, ErrorMessageResourceType = typeof(ValidationMessages), ErrorMessageResourceName = nameof(ValidationMessages.PasswordMinLength))]
    public new string NewPassword { get; set; } = null!;

    /// <summary>
    /// Gets or sets the password confirmation.
    /// </summary>
    [Required]
    [Compare("NewPassword", ErrorMessageResourceType = typeof(ValidationMessages), ErrorMessageResourceName = nameof(ValidationMessages.PasswordsDoNotMatch))]
    public new string NewPasswordConfirm { get; set; } = null!;

    /// <summary>
    /// Converts the form model to the base model.
    /// </summary>
    /// <returns>The base PasswordChangeModel.</returns>
    public PasswordChangeModel ToBaseModel()
    {
        return new PasswordChangeModel
        {
            CurrentPassword = CurrentPassword,
            NewPassword = NewPassword,
            NewPasswordConfirm = NewPasswordConfirm,
        };
    }
}
