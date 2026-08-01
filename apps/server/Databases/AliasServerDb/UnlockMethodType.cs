//-----------------------------------------------------------------------
// <copyright file="UnlockMethodType.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// Unlock methods a user can enroll (see <see cref="UserUnlockKey"/>).
/// </summary>
public enum UnlockMethodType
{
    /// <summary>
    /// Master password (KEK derived via Argon2 from the password).
    /// </summary>
    Password = 0,
}
