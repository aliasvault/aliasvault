//-----------------------------------------------------------------------
// <copyright file="RefreshTokenSuccessor.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Models;

/// <summary>
/// The refresh token that replaced another one, kept in memory for the reuse window after a rotation.
/// </summary>
/// <param name="Id">Row id of the new refresh token.</param>
/// <param name="RefreshToken">The new token value as handed to the client.</param>
public sealed record RefreshTokenSuccessor(Guid Id, string RefreshToken);
