//-----------------------------------------------------------------------
// <copyright file="AccountTier.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// Subscription tier of an account, used to target a <see cref="RateLimit"/> rule at a class of users.
/// Tiers are not implemented yet, acts as placeholder for future implementation.
/// </summary>
public enum AccountTier
{
    /// <summary>
    /// The default tier for all accounts.
    /// </summary>
    Free = 0,

    /// <summary>
    /// Premium (paid) tier. Not yet implemented, acts as placeholder for unit tests.
    /// </summary>
    Premium = 1,
}
