//-----------------------------------------------------------------------
// <copyright file="KeyRotationStatus.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.KeyRotation;

using System.Text.Json.Serialization;
using AliasVault.Shared.Models.WebApi.V2.Vault;

/// <summary>
/// How POST /v2/KeyRotation ended.
/// </summary>
[JsonConverter(typeof(KebabCaseEnumConverter))]
public enum KeyRotationStatus
{
    /// <summary>
    /// The rotation was applied.
    /// </summary>
    Ok,

    /// <summary>
    /// The server state moved on since the client computed the rotation; nothing was changed.
    /// </summary>
    Outdated,
}
