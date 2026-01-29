//-----------------------------------------------------------------------
// <copyright file="ApiErrorCode.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.Enums;

/// <summary>
/// Enumeration of error codes returned by the API.
/// These codes are used by clients for localization and proper error handling.
/// Using explicit string keys ensures backward compatibility when adding new error codes.
/// </summary>
public enum ApiErrorCode
{
    /// <summary>
    /// Refresh token is required but was not provided.
    /// </summary>
    REFRESH_TOKEN_REQUIRED,

    /// <summary>
    /// User account is locked.
    /// </summary>
    ACCOUNT_LOCKED,

    /// <summary>
    /// User account is blocked.
    /// </summary>
    ACCOUNT_BLOCKED,

    /// <summary>
    /// The provided refresh token is invalid.
    /// </summary>
    INVALID_REFRESH_TOKEN,

    /// <summary>
    /// Public registration is disabled on this server.
    /// </summary>
    PUBLIC_REGISTRATION_DISABLED,

    /// <summary>
    /// User not found.
    /// </summary>
    USER_NOT_FOUND,

    /// <summary>
    /// Username is required but was not provided.
    /// </summary>
    USERNAME_REQUIRED,

    /// <summary>
    /// Username is already in use.
    /// </summary>
    USERNAME_ALREADY_IN_USE,

    /// <summary>
    /// Username is available.
    /// </summary>
    USERNAME_AVAILABLE,

    /// <summary>
    /// Username does not match.
    /// </summary>
    USERNAME_MISMATCH,

    /// <summary>
    /// Password does not match.
    /// </summary>
    PASSWORD_MISMATCH,

    /// <summary>
    /// Account was successfully deleted.
    /// </summary>
    ACCOUNT_SUCCESSFULLY_DELETED,

    /// <summary>
    /// Username cannot be empty or whitespace.
    /// </summary>
    USERNAME_EMPTY_OR_WHITESPACE,

    /// <summary>
    /// Username is too short.
    /// </summary>
    USERNAME_TOO_SHORT,

    /// <summary>
    /// Username is too long.
    /// </summary>
    USERNAME_TOO_LONG,

    /// <summary>
    /// Username is not a valid email address.
    /// </summary>
    USERNAME_INVALID_EMAIL,

    /// <summary>
    /// Username contains invalid characters.
    /// </summary>
    USERNAME_INVALID_CHARACTERS,

    /// <summary>
    /// There are pending database migrations.
    /// </summary>
    PENDING_MIGRATIONS,

    /// <summary>
    /// Internal server error occurred.
    /// </summary>
    INTERNAL_SERVER_ERROR,

    /// <summary>
    /// Generic vault error.
    /// </summary>
    VAULT_ERROR,

    /// <summary>
    /// Unknown error occurred.
    /// </summary>
    UNKNOWN_ERROR,

    /// <summary>
    /// Invalid authenticator code provided.
    /// </summary>
    INVALID_AUTHENTICATOR_CODE,

    /// <summary>
    /// Invalid recovery code provided.
    /// </summary>
    INVALID_RECOVERY_CODE,

    /// <summary>
    /// Vault is not up-to-date and requires synchronization.
    /// </summary>
    VAULT_NOT_UP_TO_DATE,

    /// <summary>
    /// Mobile login request not found or expired.
    /// </summary>
    MOBILE_LOGIN_REQUEST_NOT_FOUND,

    /// <summary>
    /// Mobile login request already fulfilled.
    /// </summary>
    MOBILE_LOGIN_REQUEST_ALREADY_FULFILLED,
}
