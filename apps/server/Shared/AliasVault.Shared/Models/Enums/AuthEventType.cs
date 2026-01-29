//-----------------------------------------------------------------------
// <copyright file="AuthEventType.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.Enums;

/// <summary>
/// Represents the type of authentication event.
/// </summary>
public enum AuthEventType
{
    /// <summary>
    /// Represents a standard login attempt.
    /// </summary>
    Login = 1,

    /// <summary>
    /// Represents a two-factor authentication attempt.
    /// </summary>
    TwoFactorAuthentication = 2,

    /// <summary>
    /// Represents a user logout event.
    /// </summary>
    Logout = 3,

    /// <summary>
    /// Represents a mobile login attempt (login via QR code from mobile app).
    /// </summary>
    MobileLogin = 4,

    /// <summary>
    /// Represents JWT access token refresh event issued by client to API.
    /// </summary>
    TokenRefresh = 10,

    /// <summary>
    /// Represents a password reset event.
    /// </summary>
    PasswordReset = 20,

    /// <summary>
    /// Represents a password change event.
    /// </summary>
    PasswordChange = 21,

    /// <summary>
    /// Represents enabling two-factor authentication in settings.
    /// </summary>
    TwoFactorAuthEnable = 22,

    /// <summary>
    /// Represents disabling two-factor authentication in settings.
    /// </summary>
    TwoFactorAuthDisable = 23,

    /// <summary>
    /// Represents a user registration event.
    /// </summary>
    Register = 30,

    /// <summary>
    /// Represents a user account deletion event.
    /// </summary>
    AccountDeletion = 99,
}
