//-----------------------------------------------------------------------
// <copyright file="MobileLoginErrorCode.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Utilities;

/// <summary>
/// Error codes for mobile login operations.
/// These codes are used to provide translatable error messages to users.
/// </summary>
public enum MobileLoginErrorCode
{
    /// <summary>
    /// The mobile login request has timed out after 2 minutes.
    /// </summary>
    Timeout,

    /// <summary>
    /// A generic error occurred during mobile login.
    /// </summary>
    Generic,
}
