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

    /// <summary>
    /// Registration rate limit exceeded for this IP address.
    /// </summary>
    REGISTRATION_RATE_LIMIT_EXCEEDED,

    /// <summary>
    /// Generic user account registration failure.
    /// </summary>
    REGISTRATION_FAILED,

    /// <summary>
    /// A vault key already exists for this user/key type.
    /// </summary>
    VAULT_KEY_ALREADY_EXISTS,

    /// <summary>
    /// The user has no vault key so the requested operation is unavailable; use the legacy v1 flow.
    /// </summary>
    VAULT_KEY_NOT_FOUND,

    /// <summary>
    /// The referenced shared manifest does not exist or is not owned by the caller.
    /// </summary>
    SHARED_MANIFEST_NOT_FOUND,

    /// <summary>
    /// The recipient has no usable public key to encrypt a shared manifest key for, or the referenced key is invalid.
    /// </summary>
    RECIPIENT_KEY_NOT_FOUND,

    /// <summary>
    /// The supplied algorithm is not valid for the requested operation.
    /// </summary>
    INVALID_ALGORITHM,

    /// <summary>
    /// The supplied manifest id is missing or malformed. Retrying the request unchanged cannot succeed.
    /// </summary>
    MANIFEST_ID_INVALID,

    /// <summary>
    /// The supplied manifest id is already in use by a different manifest. The client must mint a fresh id and retry.
    /// </summary>
    MANIFEST_ID_TAKEN,

    /// <summary>
    /// The referenced group does not exist, is not a shared group, or is not one the caller may administer.
    /// </summary>
    GROUP_NOT_FOUND,

    /// <summary>
    /// The group already holds as many shared manifests as it is entitled to, so no further one can be created.
    /// </summary>
    GROUP_MANIFEST_LIMIT_REACHED,

    /// <summary>
    /// The invitation does not exist, is not addressed to (or sent by) the caller, or was already answered.
    /// </summary>
    INVITATION_NOT_FOUND,

    /// <summary>
    /// There is already an open offer of access to this shared manifest for this member.
    /// </summary>
    INVITATION_ALREADY_EXISTS,

    /// <summary>
    /// The account access was offered to is not on the group's membership roster. Who belongs to a group is decided
    /// outside the client, so this cannot be resolved by the caller.
    /// </summary>
    NOT_GROUP_MEMBER,

    /// <summary>
    /// The member already holds access to this shared manifest.
    /// </summary>
    ACCESS_ALREADY_GRANTED,

    /// <summary>
    /// An admin of the group cannot take away their own access to a shared manifest.
    /// </summary>
    CANNOT_REVOKE_OWN_ACCESS,

    /// <summary>
    /// The member is the last one who can open one of the group's shared manifests, so taking their access away would
    /// leave that manifest unopenable. Somebody else has to be given access to it first.
    /// </summary>
    LAST_MANIFEST_GRANT_HOLDER,

    /// <summary>
    /// The account access was offered to has published no public key, so a shared manifest key cannot be encrypted for
    /// it. That account has to finish upgrading its vault before it can be given access to anything.
    /// </summary>
    INVITE_RECIPIENT_NOT_READY,

    /// <summary>
    /// The shared manifest's key was rotated after the offer of access was made, so the key sealed into the offer no
    /// longer opens the manifest. The offer is closed and the inviter has to make a fresh one.
    /// </summary>
    INVITATION_KEY_OUTDATED,

    /// <summary>
    /// The client action does not exist, or is not addressed to the caller.
    /// </summary>
    CLIENT_ACTION_NOT_FOUND,

    /// <summary>
    /// Mobile login request contains an invalid client public key.
    /// </summary>
    MOBILE_LOGIN_INVALID_PUBLIC_KEY,

    /// <summary>
    /// Too many mobile login requests were created from this client in a short period.
    /// </summary>
    MOBILE_LOGIN_RATE_LIMIT_EXCEEDED,

    /// <summary>
    /// The capability the request needs is not enabled for this account on this server.
    /// </summary>
    CAPABILITY_NOT_AVAILABLE,

    /// <summary>
    /// The supplied KEK derivation parameters are not within expected bounds.
    /// </summary>
    INVALID_ENCRYPTION_PARAMETERS,
}
