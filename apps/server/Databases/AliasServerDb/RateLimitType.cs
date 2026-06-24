//-----------------------------------------------------------------------
// <copyright file="RateLimitType.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasServerDb;

/// <summary>
/// The action a <see cref="RateLimit"/> rule governs.
/// </summary>
public enum RateLimitType
{
    /// <summary>
    /// Limits the creation of new email aliases.
    /// </summary>
    AliasCreation = 0,
}
