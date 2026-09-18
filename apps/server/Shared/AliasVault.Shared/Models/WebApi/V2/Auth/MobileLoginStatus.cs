//-----------------------------------------------------------------------
// <copyright file="MobileLoginStatus.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Models.WebApi.V2.Auth;

using System.Text.Json.Serialization;

/// <summary>
/// State of a mobile login request as seen by the polling client.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum MobileLoginStatus
{
    /// <summary>
    /// The mobile app has not answered yet.
    /// </summary>
    Pending,

    /// <summary>
    /// The mobile app approved the request.
    /// </summary>
    Approved,

    /// <summary>
    /// The mobile app declined the request.
    /// </summary>
    Declined,
}
