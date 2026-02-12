//-----------------------------------------------------------------------
// <copyright file="PasswordVerificationResult.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services.Auth.Enums;

/// <summary>
/// Result of a password verification attempt.
/// </summary>
public enum PasswordVerificationResult
{
    /// <summary>
    /// Password was verified successfully.
    /// </summary>
    Success,

    /// <summary>
    /// The password entered was incorrect.
    /// </summary>
    InvalidPassword,

    /// <summary>
    /// A server error occurred during verification.
    /// </summary>
    ServerError,
}
