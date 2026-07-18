//-----------------------------------------------------------------------
// <copyright file="EffectiveRateLimit.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Services;

/// <summary>
/// A resolved limit for a user: <paramref name="MaxCount"/> over a window (<paramref name="WindowSeconds"/> 0 =
/// absolute cap, &gt; 0 = rolling window).
/// </summary>
/// <param name="WindowSeconds">The rolling window length in seconds, or 0 for an absolute cap.</param>
/// <param name="MaxCount">The maximum allowed count for the window.</param>
public sealed record EffectiveRateLimit(int WindowSeconds, int MaxCount);
