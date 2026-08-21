//-----------------------------------------------------------------------
// <copyright file="CapabilityValue.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Server.Capabilities;

using System;

/// <summary>
/// Capability values travel as strings so one can carry a cap or a variant name and not only an on/off.
/// </summary>
public static class CapabilityValue
{
    /// <summary>
    /// The value of a boolean capability that is on.
    /// </summary>
    public const string On = "true";

    /// <summary>
    /// The value of a boolean capability that is off.
    /// </summary>
    public const string Off = "false";

    /// <summary>
    /// Whether a resolved value means the capability is on. Anything that is not "true" is off.
    /// </summary>
    /// <param name="value">The resolved value.</param>
    /// <returns>True when the capability is on.</returns>
    public static bool IsEnabled(string? value) => string.Equals(value, On, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The value to store for a boolean capability.
    /// </summary>
    /// <param name="enabled">Whether the capability should be on.</param>
    /// <returns>The value to store.</returns>
    public static string From(bool enabled) => enabled ? On : Off;
}
